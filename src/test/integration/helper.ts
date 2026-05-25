import * as path from 'path';
import * as vscode from 'vscode';

export function testWorkspaceRoot(): vscode.Uri {
    return vscode.Uri.file(process.cwd());
}

function testRunId(): string {
    return process.env.VSCODE_TEST_RUN_ID ?? 'default';
}

export function testFixtureRoot(): vscode.Uri {
    return vscode.Uri.joinPath(testWorkspaceRoot(), '.vscode-test', 'fixtures', testRunId());
}

export async function ensureTestWorkspace(): Promise<void> {
    if (vscode.workspace.getWorkspaceFolder(testWorkspaceRoot()) !== undefined) {
        return;
    }

    vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders?.length ?? 0,
        0,
        { uri: testWorkspaceRoot(), name: 'php-import-helper-test' }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
}

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

export async function openWorkspaceFile(relativePath: string, content: string): Promise<vscode.TextEditor> {
    await ensureTestWorkspace();
    const uri = vscode.Uri.joinPath(testFixtureRoot(), relativePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    const document = await vscode.workspace.openTextDocument(uri);

    return await vscode.window.showTextDocument(document);
}

export async function wait(ms = 100): Promise<void> {
    return void await new Promise((resolve) => setTimeout(resolve, ms));
}
