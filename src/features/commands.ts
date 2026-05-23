import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { DeclarationParser } from '../core/DeclarationParser';
import { ImportManager } from '../core/ImportManager';
import type { NamespaceCache } from '../core/NamespaceCache';
import { applyGeneratedNamespace, generateNamespace } from '../core/NamespaceGenerator';
import { PhpClassDetector } from '../core/PhpClassDetector';
import { SortManager } from '../core/SortManager';
import { UseFoldingRangeCalculator } from '../core/UseFoldingRangeCalculator';
import { parseAutoload } from '../core/composer';
import type { CacheEntry } from '../types';
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

            const resolved = cache.resolve(word);
            if (resolved.length !== 1) {
                return;
            }

            const prefix = leadingSeparator(editor.document.uri) ? '\\' : '';
            await replaceTargetWord(editor, `${prefix}${resolved[0].fqcn}`, targetRange);
        }),
        vscode.commands.registerCommand('phpImportHelper.import', async (className?: string) => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const word = targetWord(editor, className);
            if (word === null) {
                return;
            }

            const resolved = cache.resolve(word);
            if (resolved.length !== 1) {
                return;
            }

            const importedText = importManager.addImport(editor.document.getText(), resolved[0].fqcn);
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

            const composerPath = path.join(workspaceFolder.uri.fsPath, 'composer.json');
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
