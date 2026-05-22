import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { DeclarationParser } from '../core/DeclarationParser';
import { ImportManager } from '../core/ImportManager';
import type { NamespaceCache } from '../core/NamespaceCache';
import { generateNamespace } from '../core/NamespaceGenerator';
import { PhpClassDetector } from '../core/PhpClassDetector';
import { SortManager } from '../core/SortManager';
import { parseAutoload } from '../core/composer';
import type { CacheEntry } from '../types';
import { leadingSeparator, sortMode } from '../utils/config';

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

async function replaceDocument(editor: vscode.TextEditor, text: string): Promise<void> {
    const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length)
    );

    await editor.edit((edit) => edit.replace(fullRange, text));
}

async function replaceSelectedWord(editor: vscode.TextEditor, replacement: string): Promise<void> {
    const range = editor.document.getWordRangeAtPosition(
        editor.selection.active,
        /\\?[A-Za-z_][A-Za-z0-9_\\]*/
    );

    if (range === undefined) {
        return;
    }

    await editor.edit((edit) => edit.replace(range, replacement));
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
        vscode.commands.registerCommand('phpImportHelper.expand', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const word = selectedWord(editor);
            if (word === null) {
                return;
            }

            const resolved = cache.resolve(word);
            if (resolved.length !== 1) {
                return;
            }

            const prefix = leadingSeparator(editor.document.uri) ? '\\' : '';
            await replaceSelectedWord(editor, `${prefix}${resolved[0].fqcn}`);
        }),
        vscode.commands.registerCommand('phpImportHelper.import', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const word = selectedWord(editor);
            if (word === null) {
                return;
            }

            const resolved = cache.resolve(word);
            if (resolved.length !== 1) {
                return;
            }

            await replaceDocument(
                editor,
                importManager.addImport(editor.document.getText(), resolved[0].fqcn)
            );
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
            await replaceDocument(editor, text);
            diagnostics.update(editor.document);
        }),
        vscode.commands.registerCommand('phpImportHelper.foldUses', async () => {
            await vscode.commands.executeCommand('editor.foldAllMarkerRegions');
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
                await editor.edit((edit) =>
                    edit.insert(new vscode.Position(1, 0), `\nnamespace ${namespace};\n`)
                );
            }
        })
    );
}
