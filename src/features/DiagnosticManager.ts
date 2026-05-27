import * as vscode from 'vscode';
import { builtInClasses } from '../core/builtInClasses';
import type { DeclarationParser } from '../core/DeclarationParser';
import type { NamespaceCache } from '../core/NamespaceCache';
import type { PhpClassDetector } from '../core/PhpClassDetector';
import { DiagnosticCode } from '../types';
import { getConfig, ignoredClasses } from '../utils/config';

export class DiagnosticManager implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('phpImportHelper');
    private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly pendingDocuments = new Map<string, vscode.TextDocument>();

    public constructor(
        private readonly detector: PhpClassDetector,
        private readonly parser: DeclarationParser,
        private readonly cache: NamespaceCache
    ) {}

    public scheduleUpdate(document: vscode.TextDocument): void {
        if (document.languageId !== 'php') {
            return;
        }

        const key = document.uri.toString();
        const debounceMs = Math.max(
            0,
            getConfig(document.uri).get<number>('diagnostics.debounceMs', 300)
        );
        const existingTimer = this.pendingTimers.get(key);

        if (existingTimer !== undefined) {
            clearTimeout(existingTimer);
        }

        this.pendingDocuments.set(key, document);
        this.pendingTimers.set(
            key,
            setTimeout(() => {
                this.pendingTimers.delete(key);

                const latestDocument = this.pendingDocuments.get(key);
                if (latestDocument === undefined || latestDocument.version !== document.version) {
                    return;
                }

                this.pendingDocuments.delete(key);
                this.update(latestDocument);
            }, debounceMs)
        );
    }

    public update(document: vscode.TextDocument): void {
        if (document.languageId !== 'php') {
            return;
        }

        const config = getConfig(document.uri);
        const ignored = new Set(ignoredClasses(document.uri));
        const text = document.getText();
        const parsed = this.parser.parse(text);
        const imported = new Set(
            parsed.useStatements
                .filter((item) => item.kind === 'class')
                .map((item) => item.className)
        );
        const declared = new Set(parsed.declaredClassNames);
        const detected = this.detector.detectAllWithPositions(text);
        const detectedNames = new Set(detected.map((item) => item.name));
        const importUsages = new Set(this.detector.detectImportUsages(text));
        const diagnostics: vscode.Diagnostic[] = [];

        if (config.get<boolean>('highlightNotImported', true)) {
            for (const item of detected) {
                if (
                    ignored.has(item.name) ||
                    imported.has(item.name) ||
                    declared.has(item.name) ||
                    builtInClasses.has(item.name)
                ) {
                    continue;
                }

                if (this.isSameNamespace(parsed.namespace, item.name)) {
                    continue;
                }

                const range = new vscode.Range(
                    item.line,
                    item.character,
                    item.line,
                    item.character + item.name.length
                );
                const diagnostic = new vscode.Diagnostic(
                    range,
                    `Class '${item.name}' is not imported.`,
                    vscode.DiagnosticSeverity.Warning
                );
                diagnostic.code = DiagnosticCode.ClassNotImported;
                diagnostic.source = 'PHP Import Helper';
                diagnostics.push(diagnostic);
            }
        }

        if (config.get<boolean>('highlightNotUsed', true)) {
            for (const statement of parsed.useStatements.filter((item) => item.kind === 'class')) {
                if (ignored.has(statement.className)) {
                    continue;
                }

                if (!detectedNames.has(statement.className) && !importUsages.has(statement.className)) {
                    const range = new vscode.Range(
                        statement.line - 1,
                        0,
                        statement.line - 1,
                        statement.text.length
                    );
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Imported class '${statement.className}' is not used.`,
                        vscode.DiagnosticSeverity.Hint
                    );
                    diagnostic.code = DiagnosticCode.ClassNotUsed;
                    diagnostic.source = 'PHP Import Helper';
                    diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
                    diagnostics.push(diagnostic);
                }
            }
        }

        this.collection.set(document.uri, diagnostics);
    }

    public clear(uri: vscode.Uri): void {
        this.cancelScheduledUpdate(uri.toString());
        this.collection.delete(uri);
    }

    public dispose(): void {
        for (const key of this.pendingTimers.keys()) {
            this.cancelScheduledUpdate(key);
        }

        this.collection.dispose();
    }

    private cancelScheduledUpdate(key: string): void {
        const timer = this.pendingTimers.get(key);

        if (timer !== undefined) {
            clearTimeout(timer);
            this.pendingTimers.delete(key);
        }

        this.pendingDocuments.delete(key);
    }

    private isSameNamespace(namespace: string | null, className: string): boolean {
        if (namespace === null) {
            return this.cache.resolve(className).some((item) => item.fqcn === className);
        }

        return this.cache
            .resolve(className)
            .some((item) => item.fqcn === `${namespace}\\${className}`);
    }
}
