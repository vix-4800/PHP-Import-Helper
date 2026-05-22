import * as vscode from 'vscode';
import { DiagnosticCode } from '../types';

export class PhpCodeActionProvider implements vscode.CodeActionProvider {
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
    ): vscode.CodeAction[] {
        void document;
        void range;

        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'PHP Import Helper') {
                continue;
            }

            if (diagnostic.code === DiagnosticCode.ClassNotImported) {
                const importAction = new vscode.CodeAction('Import class', vscode.CodeActionKind.QuickFix);
                importAction.command = { command: 'phpImportHelper.import', title: 'Import Class' };
                importAction.diagnostics = [diagnostic];
                importAction.isPreferred = true;
                actions.push(importAction);

                const expandAction = new vscode.CodeAction('Expand to fully qualified name', vscode.CodeActionKind.QuickFix);
                expandAction.command = { command: 'phpImportHelper.expand', title: 'Expand Class' };
                expandAction.diagnostics = [diagnostic];
                actions.push(expandAction);
            }

            if (diagnostic.code === DiagnosticCode.ClassNotUsed) {
                const removeAction = new vscode.CodeAction('Remove unused import', vscode.CodeActionKind.QuickFix);
                removeAction.command = { command: 'phpImportHelper.removeUnused', title: 'Remove Unused Imports' };
                removeAction.diagnostics = [diagnostic];
                removeAction.isPreferred = true;
                actions.push(removeAction);
            }
        }

        return actions;
    }
}
