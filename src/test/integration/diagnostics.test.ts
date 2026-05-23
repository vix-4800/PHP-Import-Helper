import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiagnosticCode } from '../../types';
import { createPhpDocument, wait } from './helper';

suite('diagnostics and code actions', () => {
    test('reports unimported and unused classes', async () => {
        const document = await createPhpDocument(`<?php

use App\\Models\\Post;

class Foo extends Controller {}
`);

        await vscode.commands.executeCommand('phpImportHelper.refreshDiagnostics', document.uri);
        await wait();

        const diagnostics = vscode.languages.getDiagnostics(document.uri);

        assert.ok(diagnostics.some((item) => item.code === DiagnosticCode.ClassNotImported && item.message.includes('Controller')));
        assert.ok(diagnostics.some((item) => item.code === DiagnosticCode.ClassNotUsed && item.message.includes('Post')));
    });

    test('provides quick fixes for import and unused diagnostics', async () => {
        const document = await createPhpDocument(`<?php

use App\\Models\\Post;

class Foo extends Controller {}
`);

        await vscode.commands.executeCommand('phpImportHelper.refreshDiagnostics', document.uri);
        await wait();

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            document.uri,
            new vscode.Range(2, 0, 4, 28),
            vscode.CodeActionKind.QuickFix.value,
        );

        assert.ok(actions?.some((action) => action.title === 'Import class'));
        assert.ok(actions?.some((action) => action.title === 'Expand to fully qualified name'));
        assert.ok(actions?.some((action) => action.title === 'Remove unused import'));
    });

    test('quick fixes pass diagnostic target to import and expand commands', async () => {
        const document = await createPhpDocument(`<?php

class Foo extends Controller {}
`);

        await vscode.commands.executeCommand('phpImportHelper.refreshDiagnostics', document.uri);
        await wait();

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            document.uri,
            new vscode.Range(2, 18, 2, 28),
            vscode.CodeActionKind.QuickFix.value,
        );
        const importAction = actions?.find((action) => action.title === 'Import class');
        const expandAction = actions?.find((action) => action.title === 'Expand to fully qualified name');

        assert.strictEqual(importAction?.command?.arguments?.[0], 'Controller');
        assert.ok(importAction?.command?.arguments?.[1] instanceof vscode.Range);
        assert.strictEqual(expandAction?.command?.arguments?.[0], 'Controller');
        assert.ok(expandAction?.command?.arguments?.[1] instanceof vscode.Range);
    });
});
