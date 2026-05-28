import * as vscode from 'vscode';
import { DeclarationParser } from './core/DeclarationParser';
import { ImportManager } from './core/ImportManager';
import { NamespaceCache } from './core/NamespaceCache';
import { PhpClassDetector } from './core/PhpClassDetector';
import { SortManager } from './core/SortManager';
import { AutoImportOnSave } from './features/AutoImportOnSave';
import { CacheStatusBarController } from './features/CacheStatusBarController';
import { PhpCodeActionProvider } from './features/CodeActionProvider';
import { foldUsesInEditor, registerCommands } from './features/commands';
import { DiagnosticManager } from './features/DiagnosticManager';
import { PerformanceMonitor } from './features/PerformanceMonitor';
import { computeSaveHookText } from './features/saveHooks';
import { UseFoldingRangeProvider } from './features/UseFoldingRangeProvider';
import { getVisiblePhpDocuments } from './features/visiblePhpDocuments';
import { getConfig, ignoredClasses, removeDuplicateImports, sortMode } from './utils/config';

export function activate(context: vscode.ExtensionContext): void {
    const parser = new DeclarationParser();
    const detector = new PhpClassDetector();
    const performanceChannel = vscode.window.createOutputChannel('PHP Import Helper Performance');
    const performance = new PerformanceMonitor(performanceChannel);
    const cache = new NamespaceCache(context.storageUri, performance);
    const diagnostics = new DiagnosticManager(detector, parser, cache, performance);
    const importManager = new ImportManager(parser);
    const sortManager = new SortManager(parser);
    const autoImport = new AutoImportOnSave(detector, parser, cache);
    const cacheStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    const cacheStatus = new CacheStatusBarController(cacheStatusItem);
    const autoFoldUses = async (editor: vscode.TextEditor | undefined): Promise<void> => {
        if (
            editor?.document.languageId !== 'php' ||
            !getConfig(editor.document.uri).get<boolean>('autoFoldUses', false)
        ) {
            return;
        }

        await foldUsesInEditor(editor);
    };
    const refreshVisibleDiagnostics = (): void => {
        for (const document of getVisiblePhpDocuments(vscode.window.visibleTextEditors)) {
            diagnostics.update(document, { force: true });
        }
    };

    context.subscriptions.push(
        cache,
        performanceChannel,
        cacheStatusItem,
        cache.onDidChangeActivity((event) => cacheStatus.handleActivity(event)),
        cache.onDidUpdate(refreshVisibleDiagnostics),
        diagnostics,
        vscode.languages.registerCodeActionsProvider(
            { language: 'php' },
            new PhpCodeActionProvider(),
            {
                providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
            }
        ),
        vscode.languages.registerFoldingRangeProvider(
            { language: 'php' },
            new UseFoldingRangeProvider()
        ),
        vscode.workspace.onDidOpenTextDocument((document) => {
            diagnostics.update(document, { force: true });
            void autoFoldUses(vscode.window.activeTextEditor);
        }),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            void autoFoldUses(editor);
        }),
        vscode.workspace.onDidChangeTextDocument((event) => diagnostics.scheduleUpdate(event.document)),
        vscode.workspace.onDidCloseTextDocument((document) => diagnostics.clear(document.uri)),
        vscode.workspace.onWillSaveTextDocument((event) => {
            if (event.document.languageId !== 'php') {
                return;
            }

            const originalText = event.document.getText();
            const config = getConfig(event.document.uri);
            const text = computeSaveHookText(originalText, {
                autoImportOnSave: config.get<boolean>('autoImportOnSave', false),
                removeOnSave: config.get<boolean>('removeOnSave', false),
                sortOnSave: config.get<boolean>('sortOnSave', false),
                sortMode: sortMode(event.document.uri),
                ignoredClasses: ignoredClasses(event.document.uri),
            }, {
                autoImportText: (value) => autoImport.computeTextForText(value),
                removeUnusedText: (value, ignored) =>
                    importManager.removeUnused(
                        value,
                        ignored,
                        removeDuplicateImports(event.document.uri)
                    ),
                sortText: (value, mode) => sortManager.sortText(value, mode),
            });

            if (text !== originalText) {
                const range = new vscode.Range(
                    event.document.positionAt(0),
                    event.document.positionAt(originalText.length)
                );
                event.waitUntil(Promise.resolve([vscode.TextEdit.replace(range, text)]));
            }
        })
    );

    registerCommands(context, parser, cache, diagnostics, performance);
    void cache.initialize();

    for (const document of getVisiblePhpDocuments(vscode.window.visibleTextEditors)) {
        diagnostics.update(document, { force: true });
    }
}

export function deactivate(): void {}
