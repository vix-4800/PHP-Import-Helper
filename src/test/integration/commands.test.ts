import * as assert from 'assert';
import * as vscode from 'vscode';
import { getText, openPhpEditor, wait } from './helper';

suite('commands', () => {
    test('sort command sorts imports in active PHP editor', async () => {
        const editor = await openPhpEditor(`<?php

use App\\Handler10;
use App\\Handler2;

class Foo {}
`);

        await vscode.commands.executeCommand('phpImportHelper.sort');
        await wait();

        assert.ok(getText(editor).indexOf('Handler2') < getText(editor).indexOf('Handler10'));
    });

    test('remove unused command removes unused imports', async () => {
        const editor = await openPhpEditor(`<?php

use App\\Models\\User;
use App\\Models\\Post;

class Foo {
    public function user(): User {}
}
`);

        await vscode.commands.executeCommand('phpImportHelper.removeUnused');
        await wait();

        assert.ok(getText(editor).includes('use App\\Models\\User;'));
        assert.ok(!getText(editor).includes('use App\\Models\\Post;'));
    });

    test('expand command replaces selected class with fully qualified name from cache', async () => {
        const editor = await openPhpEditor(`<?php

class Foo extends Controller {}
`);
        const position = new vscode.Position(2, 20);
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Controller', fqcn: 'App\\Http\\Controller', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.expand');
        await wait();

        assert.ok(getText(editor).includes('\\App\\Http\\Controller'));
    });

    test('import command sorts imports when autoSort is enabled', async () => {
        const editor = await openPhpEditor(`<?php

use App\\Handler10;

class Foo extends Handler2 {}
`);
        const position = new vscode.Position(4, 20);
        editor.selection = new vscode.Selection(position, position);

        await vscode.workspace.getConfiguration('phpImportHelper').update('autoSort', true, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Handler2', fqcn: 'App\\Handler2', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.import');
        await wait();

        assert.ok(getText(editor).indexOf('Handler2') < getText(editor).indexOf('Handler10'));
    });

    test('import all command imports unique unresolved classes and cleans existing FQCN aliases', async () => {
        const editor = await openPhpEditor(`<?php

use yii\\httpclient\\Client as cl;

class Foo {
    public function show(Request $request): Response {
        return new \\yii\\httpclient\\Client();
    }
}
`);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Request', fqcn: 'App\\Http\\Request', uri: editor.document.uri },
            { className: 'Response', fqcn: 'App\\Http\\Response', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.importAll');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use App\\Http\\Request;'));
        assert.ok(text.includes('use App\\Http\\Response;'));
        assert.ok(text.includes('new cl()'));
        assert.strictEqual((text.match(/yii\\httpclient\\Client/g) ?? []).length, 1);
    });
});
