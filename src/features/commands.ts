import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import type { DeclarationParser } from '../core/DeclarationParser';
import { ImportManager } from '../core/ImportManager';
import type { NamespaceCache } from '../core/NamespaceCache';
import {
    applyGeneratedNamespace,
    findNearestComposerPath,
    generateNamespace,
} from '../core/NamespaceGenerator';
import { PhpClassDetector } from '../core/PhpClassDetector';
import { SortManager } from '../core/SortManager';
import { UseFoldingRangeCalculator } from '../core/UseFoldingRangeCalculator';
import { parseAutoload } from '../core/composer';
import type { CacheEntry, ResolvedNamespace } from '../types';
import { getConfig, leadingSeparator, sortMode } from '../utils/config';

function activePhpEditor(): vscode.TextEditor | null {
    const editor = vscode.window.activeTextEditor;

    return editor?.document.languageId === 'php' ? editor : null;
}

function selectedWord(editor: vscode.TextEditor): string | null {
    const range = editor.document.getWordRangeAtPosition(
        editor.selection.active,
        /\\?[A-Za-z_][A-Za-z0-9_\\]*/
    );

    return range === undefined
        ? null
        : (editor.document.getText(range).replace(/^\\+/, '').split('\\').pop() ?? null);
}

function targetWord(editor: vscode.TextEditor, className?: string): string | null {
    return className ?? selectedWord(editor);
}

function shortName(fqcn: string): string {
    return fqcn.split('\\').pop() ?? fqcn;
}

function sortWhenConfigured(text: string, uri: vscode.Uri, sortManager: SortManager): string {
    if (!getConfig(uri).get<boolean>('autoSort', true)) {
        return text;
    }

    try {
        return sortManager.sortText(text, sortMode(uri));
    } catch {
        return text;
    }
}

async function chooseResolved(
    className: string,
    resolved: ResolvedNamespace[]
): Promise<ResolvedNamespace | null> {
    if (resolved.length === 0) {
        void vscode.window.showInformationMessage(`No import found for ${className}.`);
        return null;
    }

    if (resolved.length === 1) {
        return resolved[0];
    }

    const picked = await vscode.window.showQuickPick(
        resolved.map((item) => ({
            label: item.fqcn,
            description: item.source,
            resolved: item,
        })),
        { placeHolder: `Select import for ${className}` }
    );

    return picked?.resolved ?? null;
}

async function aliasForConflict(
    editor: vscode.TextEditor,
    parser: DeclarationParser,
    fqcn: string
): Promise<string | undefined | null> {
    const parsed = parser.parse(editor.document.getText());
    const candidateName = shortName(fqcn);
    const hasConflict = parsed.useStatements.some((statement) =>
        statement.kind === 'class' &&
        statement.className === candidateName &&
        statement.fqcn !== fqcn
    );

    if (!hasConflict) {
        return undefined;
    }

    return await vscode.window.showInputBox({
        prompt: `Alias for ${fqcn}`,
        value: candidateName,
        validateInput: (value) => value.trim() === '' ? 'Alias is required.' : null,
    }) ?? null;
}

async function replaceDocument(editor: vscode.TextEditor, text: string): Promise<void> {
    const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length)
    );

    await editor.edit((edit) => edit.replace(fullRange, text));
}

async function replaceTargetWord(
    editor: vscode.TextEditor,
    replacement: string,
    targetRange?: vscode.Range
): Promise<void> {
    const range = targetRange ?? editor.document.getWordRangeAtPosition(
        editor.selection.active,
        /\\?[A-Za-z_][A-Za-z0-9_\\]*/
    );

    if (range === undefined) {
        return;
    }

    await editor.edit((edit) => edit.replace(range, replacement));
}

function resolveTargetRange(editor: vscode.TextEditor, range?: vscode.Range): vscode.Range | undefined {
    return range ?? editor.document.getWordRangeAtPosition(
        editor.selection.active,
        /\\?[A-Za-z_][A-Za-z0-9_\\]*/
    );
}

function replaceRangeInText(
    document: vscode.TextDocument,
    text: string,
    range: vscode.Range,
    replacement: string
): string {
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);

    return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

export async function foldUsesInEditor(editor: vscode.TextEditor): Promise<void> {
    const calculator = new UseFoldingRangeCalculator();
    const ranges = calculator.calculate(
        Array.from({ length: editor.document.lineCount }, (_, line) => editor.document.lineAt(line).text)
    );

    if (ranges.length === 0) {
        return;
    }

    await vscode.commands.executeCommand('editor.fold', {
        selectionLines: ranges.map((range) => range.startLine),
    });
}

export function registerCommands(
    context: vscode.ExtensionContext,
    parser: DeclarationParser,
    cache: NamespaceCache,
    diagnostics: { update: (document: vscode.TextDocument) => void }
): void {
    const importManager = new ImportManager(parser);
    const sortManager = new SortManager(parser);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'phpImportHelper.rebuildIndex',
            async (fixtures?: CacheEntry[]) => {
                await cache.rebuild(fixtures);
            }
        ),
        vscode.commands.registerCommand(
            'phpImportHelper.refreshDiagnostics',
            async (uri?: vscode.Uri) => {
                const document =
                    uri === undefined
                        ? activePhpEditor()?.document
                        : await vscode.workspace.openTextDocument(uri);

                if (document !== undefined) {
                    diagnostics.update(document);
                }
            }
        ),
        vscode.commands.registerCommand('phpImportHelper.sort', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            await replaceDocument(
                editor,
                sortManager.sortText(editor.document.getText(), sortMode(editor.document.uri))
            );
        }),
        vscode.commands.registerCommand('phpImportHelper.removeUnused', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            await replaceDocument(editor, importManager.removeUnused(editor.document.getText()));
            diagnostics.update(editor.document);
        }),
        vscode.commands.registerCommand('phpImportHelper.expand', async (
            className?: string,
            targetRange?: vscode.Range
        ) => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const word = targetWord(editor, className);
            if (word === null) {
                return;
            }

            const resolved = await chooseResolved(word, cache.resolve(word));
            if (resolved === null) {
                return;
            }

            const prefix = leadingSeparator(editor.document.uri) ? '\\' : '';
            await replaceTargetWord(editor, `${prefix}${resolved.fqcn}`, targetRange);
        }),
        vscode.commands.registerCommand('phpImportHelper.import', async (
            className?: string,
            targetRange?: vscode.Range
        ) => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const word = targetWord(editor, className);
            if (word === null) {
                return;
            }

            const resolved = await chooseResolved(word, cache.resolve(word));
            if (resolved === null) {
                return;
            }

            if (parser.parse(editor.document.getText()).useStatements.some((statement) =>
                statement.kind === 'class' && statement.fqcn === resolved.fqcn
            )) {
                void vscode.window.showInformationMessage(`${resolved.fqcn} is already imported.`);
                return;
            }

            const alias = await aliasForConflict(editor, parser, resolved.fqcn);
            if (alias === null) {
                return;
            }

            const originalText = editor.document.getText();
            const aliasRange = alias === undefined ? undefined : resolveTargetRange(editor, targetRange);
            const textWithAlias =
                alias === undefined || aliasRange === undefined
                    ? originalText
                    : replaceRangeInText(editor.document, originalText, aliasRange, alias);
            const importedText = importManager.addImport(textWithAlias, resolved.fqcn, alias);
            await replaceDocument(editor, sortWhenConfigured(importedText, editor.document.uri, sortManager));
            diagnostics.update(editor.document);
        }),
        vscode.commands.registerCommand('phpImportHelper.importAll', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            let text = editor.document.getText();
            const imported = new Set(parser.getImportedClassNames(text));
            const detector = new PhpClassDetector();

            for (const className of detector.detectAll(text)) {
                if (imported.has(className)) {
                    continue;
                }

                const resolved = cache.resolve(className);
                if (resolved.length === 1) {
                    text = importManager.addImport(text, resolved[0].fqcn);
                    imported.add(className);
                }
            }

            text = importManager.replaceImportedFullyQualifiedClasses(text);
            text = sortWhenConfigured(text, editor.document.uri, sortManager);
            await replaceDocument(editor, text);
            diagnostics.update(editor.document);
        }),
        vscode.commands.registerCommand('phpImportHelper.foldUses', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            await foldUsesInEditor(editor);
        }),
        vscode.commands.registerCommand('phpImportHelper.generateNamespace', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (workspaceFolder === undefined) {
                return;
            }

            const composerPath = await findNearestComposerPath(
                editor.document.uri.fsPath,
                workspaceFolder.uri.fsPath,
                async (candidate) => await fs.access(candidate).then(() => true, () => false)
            );
            if (composerPath === null) {
                void vscode.window.showInformationMessage('No composer.json found.');
                return;
            }

            const composerText = await fs.readFile(composerPath, 'utf8').catch(() => null);
            if (composerText === null) {
                return;
            }

            const namespace = generateNamespace(
                editor.document.uri.fsPath,
                parseAutoload(JSON.parse(composerText) as unknown)
            );
            if (namespace !== null && namespace !== '') {
                await replaceDocument(
                    editor,
                    applyGeneratedNamespace(editor.document.getText(), namespace, parser)
                );
            }
        })
    );
}
