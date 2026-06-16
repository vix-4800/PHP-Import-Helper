import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { DeclarationParser } from '../core/DeclarationParser';
import { ImportManager } from '../core/ImportManager';
import type { NamespaceCache } from '../core/NamespaceCache';
import {
    applyGeneratedNamespace,
    findNearestComposerPath,
    generateNamespace,
} from '../core/NamespaceGenerator';
import { NamespaceResolver } from '../core/NamespaceResolver';
import { PhpClassDetector } from '../core/PhpClassDetector';
import { SortManager } from '../core/SortManager';
import { UseFoldingRangeCalculator } from '../core/UseFoldingRangeCalculator';
import { parseAutoload } from '../core/composer';
import { computeImportAllText } from '../core/importAllText';
import type { CacheEntry, ResolvedNamespace } from '../types';
import {
    getConfig,
    ignoredClasses,
    importAllOptions,
    leadingSeparator,
    removeDuplicateImports,
    resolveExcludePatterns,
    sortMode,
} from '../utils/config';
import { buildIndexExcludeGlob, shouldIncludePhpFile } from '../utils/indexExcludes';
import { PerformanceMonitor } from './PerformanceMonitor';
import { UseFoldingRangeProvider } from './UseFoldingRangeProvider';
import { parseClassTarget, type ClassTarget } from './commandTargets';

function activePhpEditor(): vscode.TextEditor | null {
    const editor = vscode.window.activeTextEditor;

    return editor?.document.languageId === 'php' ? editor : null;
}

function wordRangeAtPosition(
    editor: vscode.TextEditor,
    position: vscode.Position
): vscode.Range | undefined {
    return editor.document.getWordRangeAtPosition(
        position,
        /\\?[A-Za-z_][A-Za-z0-9_\\]*/
    );
}

function selectedTargetForSelection(
    editor: vscode.TextEditor,
    selection: vscode.Selection
): { target: ClassTarget; range: vscode.Range } | null {
    const range = wordRangeAtPosition(editor, selection.active);

    if (range === undefined) {
        return null;
    }

    const target = parseClassTarget(editor.document.getText(range));

    return target === null ? null : { target, range };
}

function commandTarget(
    editor: vscode.TextEditor,
    className?: string,
    range?: vscode.Range
): { target: ClassTarget; range?: vscode.Range } | null {
    if (className !== undefined) {
        const target = parseClassTarget(className);

        return target === null ? null : { target, range };
    }

    return selectedTargetForSelection(editor, editor.selection);
}

function normalizeCommandArgs(
    firstArg?: unknown,
    secondArg?: unknown,
    thirdArg?: unknown
): { className?: string; range?: vscode.Range } {
    if (typeof firstArg === 'string') {
        return {
            className: firstArg,
            range: secondArg instanceof vscode.Range ? secondArg : undefined,
        };
    }

    if (firstArg instanceof vscode.Uri) {
        return {
            className: typeof secondArg === 'string' ? secondArg : undefined,
            range:
                secondArg instanceof vscode.Range
                    ? secondArg
                    : thirdArg instanceof vscode.Range
                        ? thirdArg
                        : undefined,
        };
    }

    return {
        className: typeof secondArg === 'string' ? secondArg : undefined,
        range:
            firstArg instanceof vscode.Range
                ? firstArg
                : secondArg instanceof vscode.Range
                    ? secondArg
                    : thirdArg instanceof vscode.Range
                        ? thirdArg
                        : undefined,
    };
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

export function createNamespaceResolver(cache: NamespaceCache): NamespaceResolver {
    return new NamespaceResolver(cache, {
        findClassFiles: async (className, activeUri) => {
            const activeResource = activeUri === undefined
                ? undefined
                : vscode.Uri.file(activeUri.fsPath);
            const activeFolder = activeResource === undefined
                ? undefined
                : vscode.workspace.getWorkspaceFolder(activeResource);
            const roots = activeFolder === undefined
                ? (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri)
                : [activeFolder.uri];
            if (roots.length === 0) {
                roots.push(vscode.Uri.file(process.cwd()));
            }

            const files = new Map<string, vscode.Uri>();
            for (const root of roots) {
                const resource = activeFolder === undefined ? root : activeResource;
                const excludePatterns = resolveExcludePatterns(resource);
                const found = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(root, `**/${className}.php`),
                    buildIndexExcludeGlob(excludePatterns)
                );

                for (const uri of found) {
                    if (shouldIncludePhpFile(uri.fsPath, [root.fsPath], excludePatterns)) {
                        files.set(uri.toString(), uri);
                    }
                }
            }

            return [...files.values()];
        },
        readFile: async (uri) => Buffer.from(
            await vscode.workspace.fs.readFile(vscode.Uri.file(uri.fsPath))
        ).toString('utf8'),
    });
}

async function resolveTarget(
    resolver: NamespaceResolver,
    target: ClassTarget,
    activeUri: vscode.Uri
): Promise<ResolvedNamespace | null> {
    if (target.fqcn !== null) {
        return {
            fqcn: target.fqcn,
            source: 'project',
            uri: activeUri,
        };
    }

    return await chooseResolved(target.className, await resolver.resolve(target.className, activeUri));
}

async function aliasForConflict(
    editor: vscode.TextEditor,
    parser: DeclarationParser,
    fqcn: string
): Promise<string | null | undefined> {
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
        validateInput: (value) => {
            const alias = value.trim();
            if (alias === '') {
                return 'Alias is required.';
            }

            return parsed.useStatements.some((statement) =>
                statement.kind === 'class' && statement.className === alias
            )
                ? 'Alias is already in use.'
                : null;
        },
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

    const foldingProvider = vscode.languages.registerFoldingRangeProvider(
        { language: 'php' },
        new UseFoldingRangeProvider()
    );

    try {
        await vscode.commands.executeCommand('editor.fold', {
            selectionLines: ranges.map((range) => range.startLine),
        });
    } finally {
        foldingProvider.dispose();
    }
}

export function registerCommands(
    context: vscode.ExtensionContext,
    parser: DeclarationParser,
    cache: NamespaceCache & { indexStats: () => { indexedFiles: number; indexedClasses: number } },
    resolver: NamespaceResolver,
    diagnostics: {
        update: (
            document: vscode.TextDocument,
            options?: {
                force?: boolean;
            }
        ) => void;
    },
    performance: PerformanceMonitor
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
                    diagnostics.update(document, { force: true });
                }
            }
        ),
        vscode.commands.registerCommand('phpImportHelper.showPerformanceStats', async () => {
            performance.showStats(performance.snapshot(cache.indexStats()));
        }),
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

            await replaceDocument(
                editor,
                importManager.removeUnused(
                    editor.document.getText(),
                    ignoredClasses(editor.document.uri),
                    removeDuplicateImports(editor.document.uri)
                )
            );
            diagnostics.update(editor.document);
        }),
        vscode.commands.registerCommand('phpImportHelper.expand', async (
            firstArg?: unknown,
            secondArg?: unknown,
            thirdArg?: unknown
        ) => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const { className, range: targetRange } = normalizeCommandArgs(
                firstArg,
                secondArg,
                thirdArg
            );

            if (className === undefined && targetRange === undefined && editor.selections.length > 1) {
                const replacements: Array<{ range: vscode.Range; text: string }> = [];

                for (const selection of editor.selections) {
                    const target = selectedTargetForSelection(editor, selection);
                    if (target === null) {
                        continue;
                    }

                    const resolved = await resolveTarget(resolver, target.target, editor.document.uri);
                    if (resolved === null) {
                        continue;
                    }

                    const prefix = leadingSeparator(editor.document.uri) ? '\\' : '';
                    replacements.push({
                        range: target.range,
                        text: `${prefix}${resolved.fqcn}`,
                    });
                }

                replacements.sort((left, right) =>
                    editor.document.offsetAt(right.range.start) -
                    editor.document.offsetAt(left.range.start)
                );
                await editor.edit((edit) => {
                    for (const replacement of replacements) {
                        edit.replace(replacement.range, replacement.text);
                    }
                });
                if (replacements.length > 0) {
                    diagnostics.update(editor.document);
                }
                return;
            }

            const target = commandTarget(editor, className, targetRange);
            if (target === null) {
                return;
            }

            const resolved = await resolveTarget(resolver, target.target, editor.document.uri);
            if (resolved === null) {
                return;
            }

            const prefix = leadingSeparator(editor.document.uri) ? '\\' : '';
            await replaceTargetWord(editor, `${prefix}${resolved.fqcn}`, target.range);
        }),
        vscode.commands.registerCommand('phpImportHelper.import', async (
            firstArg?: unknown,
            secondArg?: unknown,
            thirdArg?: unknown
        ) => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            const { className, range: targetRange } = normalizeCommandArgs(
                firstArg,
                secondArg,
                thirdArg
            );

            if (className === undefined && targetRange === undefined && editor.selections.length > 1) {
                for (const selection of editor.selections) {
                    editor.selection = selection;
                    await vscode.commands.executeCommand('phpImportHelper.import');
                }
                return;
            }

            const target = commandTarget(editor, className, targetRange);
            if (target === null) {
                return;
            }

            const resolved = await resolveTarget(resolver, target.target, editor.document.uri);
            if (resolved === null) {
                return;
            }

            const parsed = parser.parse(editor.document.getText());
            const existingImport = parsed.useStatements.find((statement) =>
                statement.kind === 'class' && statement.fqcn === resolved.fqcn
            );
            if (existingImport !== undefined) {
                if (target.target.fqcn !== null) {
                    await replaceDocument(
                        editor,
                        importManager.replaceImportedFullyQualifiedClasses(editor.document.getText())
                    );
                    diagnostics.update(editor.document);
                    return;
                }

                void vscode.window.showInformationMessage(`${resolved.fqcn} is already imported.`);
                return;
            }

            const alias = await aliasForConflict(editor, parser, resolved.fqcn);
            if (alias === null) {
                return;
            }

            const originalText = editor.document.getText();
            const aliasRange =
                alias === undefined && target.target.fqcn === null
                    ? undefined
                    : resolveTargetRange(editor, target.range);
            const replacementName = alias ?? shortName(resolved.fqcn);
            const textWithAlias =
                aliasRange === undefined
                    ? originalText
                    : replaceRangeInText(editor.document, originalText, aliasRange, replacementName);
            let importedText = importManager.addImport(textWithAlias, resolved.fqcn, alias);
            importedText = importManager.replaceImportedFullyQualifiedClasses(importedText);
            await replaceDocument(
                editor,
                sortWhenConfigured(importedText, editor.document.uri, sortManager)
            );
            diagnostics.update(editor.document);
        }),
        vscode.commands.registerCommand('phpImportHelper.importAll', async () => {
            const editor = activePhpEditor();
            if (editor === null) {
                return;
            }

            let text = await computeImportAllText(
                editor.document.getText(),
                parser,
                new PhpClassDetector(),
                resolver,
                editor.document.uri,
                importAllOptions(editor.document.uri)
            );
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
            const composerPath = await findNearestComposerPath(
                editor.document.uri.fsPath,
                workspaceFolder?.uri.fsPath ?? path.parse(editor.document.uri.fsPath).root,
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
                parseAutoload(JSON.parse(composerText) as unknown),
                path.dirname(composerPath)
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
