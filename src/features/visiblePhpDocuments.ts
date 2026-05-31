import type * as vscode from 'vscode';

export function getVisiblePhpDocuments(
    editors: ReadonlyArray<Pick<vscode.TextEditor, 'document'>>
): vscode.TextDocument[] {
    const documents = new Map<string, vscode.TextDocument>();

    for (const editor of editors) {
        if (editor.document.languageId !== 'php') {
            continue;
        }

        documents.set(editor.document.uri.toString(), editor.document);
    }

    return [...documents.values()];
}
