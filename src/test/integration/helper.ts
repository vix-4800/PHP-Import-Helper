import * as vscode from 'vscode';

export async function createPhpDocument(content: string): Promise<vscode.TextDocument> {
    return await vscode.workspace.openTextDocument({ language: 'php', content });
}

export async function openPhpEditor(content: string): Promise<vscode.TextEditor> {
    const document = await createPhpDocument(content);
    return await vscode.window.showTextDocument(document);
}

export function getText(editor: vscode.TextEditor): string {
    return editor.document.getText();
}

export async function wait(ms = 100): Promise<void> {
    return void await new Promise((resolve) => setTimeout(resolve, ms));
}
