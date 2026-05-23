import * as vscode from 'vscode';
import { DeclarationParser } from './core/DeclarationParser';
import { ImportManager } from './core/ImportManager';
import { NamespaceCache } from './core/NamespaceCache';
import { PhpClassDetector } from './core/PhpClassDetector';
import { SortManager } from './core/SortManager';
import { AutoImportOnSave } from './features/AutoImportOnSave';
import { PhpCodeActionProvider } from './features/CodeActionProvider';
import { foldUsesInEditor, registerCommands } from './features/commands';
import { DiagnosticManager } from './features/DiagnosticManager';
import { UseFoldingRangeProvider } from './features/UseFoldingRangeProvider';
import { getConfig, sortMode } from './utils/config';

export function activate(context: vscode.ExtensionContext): void {
    const parser = new DeclarationParser();
    const detector = new PhpClassDetector();
    const cache = new NamespaceCache();
    const diagnostics = new DiagnosticManager(detector, parser, cache);
    const importManager = new ImportManager(parser);
    const sortManager = new SortManager(parser);
    const autoImport = new AutoImportOnSave(detector, parser, cache);
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
        for (const document of vscode.workspace.textDocuments) {
            diagnostics.update(document);
        }
    };

    context.subscriptions.push(
        cache,
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
            diagnostics.update(document);
            void autoFoldUses(vscode.window.activeTextEditor);
        }),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            void autoFoldUses(editor);
        }),
        vscode.workspace.onDidChangeTextDocument((event) => diagnostics.update(event.document)),
        vscode.workspace.onDidCloseTextDocument((document) => diagnostics.clear(document.uri)),
        vscode.workspace.onWillSaveTextDocument((event) => {
            if (event.document.languageId !== 'php') {
                return;
            }

            let text = event.document.getText();
            const config = getConfig(event.document.uri);

            if (config.get<boolean>('autoImportOnSave', false)) {
                text = autoImport.computeText(event.document);
            }

            if (config.get<boolean>('removeOnSave', false)) {
                text = importManager.removeUnused(text);
            }

            if (config.get<boolean>('sortOnSave', false)) {
                try {
                    text = sortManager.sortText(text, sortMode(event.document.uri));
                } catch {
                    return;
                }
            }

            if (text !== event.document.getText()) {
                const range = new vscode.Range(
                    event.document.positionAt(0),
                    event.document.positionAt(event.document.getText().length)
                );
                event.waitUntil(Promise.resolve([vscode.TextEdit.replace(range, text)]));
            }
        })
    );

    registerCommands(context, parser, cache, diagnostics);
    void cache.initialize();

    for (const document of vscode.workspace.textDocuments) {
        diagnostics.update(document);
    }
}

export function deactivate(): void {}
