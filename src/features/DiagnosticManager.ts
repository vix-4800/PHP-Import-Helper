import * as vscode from 'vscode';
import { builtInClasses } from '../core/builtInClasses';
import type { DeclarationParser } from '../core/DeclarationParser';
import type { NamespaceCache } from '../core/NamespaceCache';
import type { PhpClassDetector } from '../core/PhpClassDetector';
import type { DetectedClassReference, DocumentAnalysis } from '../types';
import { DiagnosticCode } from '../types';
import { getConfig, ignoredClasses } from '../utils/config';
import type { PerformanceMonitor } from './PerformanceMonitor';

interface UpdateOptions {
    force?: boolean;
}

export class DiagnosticManager implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('phpImportHelper');
    private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly pendingDocuments = new Map<string, vscode.TextDocument>();
    private readonly lastAnalyzedVersions = new Map<string, number>();
    private readonly analysisCache = new Map<string, DocumentAnalysis>();

    public constructor(
        private readonly detector: PhpClassDetector,
        private readonly parser: DeclarationParser,
        private readonly cache: NamespaceCache,
        private readonly performance?: PerformanceMonitor
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
                if (latestDocument?.version !== document.version) {
                    return;
                }

                this.pendingDocuments.delete(key);
                this.update(latestDocument);
            }, debounceMs)
        );
    }

    public update(document: vscode.TextDocument, options: UpdateOptions = {}): void {
        if (document.languageId !== 'php') {
            return;
        }

        const startedAt = Date.now();
        const key = document.uri.toString();
        if (!options.force && this.lastAnalyzedVersions.get(key) === document.version) {
            return;
        }

        const config = getConfig(document.uri);
        const ignored = new Set(ignoredClasses(document.uri));
        const analysis = this.getDocumentAnalysis(document);
        const parsed = analysis.parsed;
        const imported = new Set(
            parsed.useStatements
                .filter((item) => item.kind === 'class')
                .map((item) => item.className)
        );
        const declared = new Set(parsed.declaredClassNames);
        const detected = this.detector.filterImportCandidates(analysis.references);
        const detectedNames = new Set(detected.map((item) => item.name));
        const importUsages = new Set(analysis.importUsages);
        const diagnostics: vscode.Diagnostic[] = [];
        const seenImports = new Set<string>();

        for (const statement of parsed.useStatements.filter((item) => item.kind === 'class')) {
            const importKey = `${statement.kind}:${statement.fqcn}:${statement.alias ?? ''}`;
            if (!seenImports.has(importKey)) {
                seenImports.add(importKey);
                continue;
            }

            const range = new vscode.Range(
                statement.line - 1,
                0,
                statement.line - 1,
                statement.text.length
            );
            const diagnostic = new vscode.Diagnostic(
                range,
                `Import '${statement.fqcn}' is duplicated.`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = DiagnosticCode.DuplicateImport;
            diagnostic.source = 'PHP Import Helper';
            diagnostics.push(diagnostic);
        }

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

                if (this.isAvailableWithoutImport(parsed.namespace, item)) {
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
        this.lastAnalyzedVersions.set(key, document.version);
        this.performance?.recordDiagnosticsUpdate({
            fileName: document.fileName.split(/[\\/]/).pop() ?? document.fileName,
            version: document.version,
            ms: Date.now() - startedAt,
            refs: detected.length,
            trace: getConfig(document.uri).get<boolean>('performance.trace', false),
        });
    }
    public clear(uri: vscode.Uri): void {
        const key = uri.toString();

        this.cancelScheduledUpdate(key);
        this.analysisCache.delete(key);
        this.lastAnalyzedVersions.delete(key);
        this.collection.delete(uri);
    }

    public dispose(): void {
        for (const key of this.pendingTimers.keys()) {
            this.cancelScheduledUpdate(key);
        }

        this.analysisCache.clear();
        this.lastAnalyzedVersions.clear();
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

    private getDocumentAnalysis(document: vscode.TextDocument): DocumentAnalysis {
        const key = document.uri.toString();
        const cached = this.analysisCache.get(key);

        if (cached?.version === document.version) {
            return cached;
        }

        const text = document.getText();
        const references = this.detector.detectReferences(text);
        const analysis: DocumentAnalysis = {
            version: document.version,
            parsed: this.parser.parse(text),
            references,
            importUsages: this.detector.extractImportUsages(references),
        };

        this.analysisCache.set(key, analysis);

        return analysis;
    }

    private isAvailableWithoutImport(
        namespace: string | null,
        reference: DetectedClassReference
    ): boolean {
        const resolved = this.cache.resolve(reference.name);

        if (namespace === null) {
            return (
                resolved.some((item) => item.fqcn === reference.name) ||
                (resolved.length === 0 && reference.referenceKind === 'runtime')
            );
        }

        return resolved.some((item) => item.fqcn === `${namespace}\\${reference.name}`);
    }
}
