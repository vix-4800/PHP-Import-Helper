import * as assert from 'assert';
import * as vscode from 'vscode';
import { getText, openPhpEditor, openWorkspaceFile, testFixtureRoot, wait } from './helper';

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

    test('expand command respects leadingSeparator setting', async () => {
        const editor = await openPhpEditor(`<?php

class Foo extends Controller {}
`);
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previous = config.get<boolean>('leadingSeparator', true);
        const position = new vscode.Position(2, 20);
        editor.selection = new vscode.Selection(position, position);

        try {
            await config.update('leadingSeparator', false, vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
                { className: 'Controller', fqcn: 'App\\Http\\Controller', uri: editor.document.uri },
            ]);
            await vscode.commands.executeCommand('phpImportHelper.expand');
            await wait();

            assert.ok(getText(editor).includes('extends App\\Http\\Controller'));
            assert.ok(!getText(editor).includes('extends \\App\\Http\\Controller'));
        } finally {
            await config.update('leadingSeparator', previous, vscode.ConfigurationTarget.Global);
        }
    });

    test('expand command ignores editor context document uri argument', async () => {
        const editor = await openPhpEditor(`<?php

class Foo extends Controller {}
`);
        const position = new vscode.Position(2, 20);
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Controller', fqcn: 'Framework\\Web\\Controller', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.expand', editor.document.uri);
        await wait();

        assert.ok(getText(editor).includes('\\Framework\\Web\\Controller'));
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

    test('import command ignores editor context document uri argument', async () => {
        const editor = await openPhpEditor(`<?php

class Foo extends Controller {}
`);
        const position = new vscode.Position(2, 20);
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Controller', fqcn: 'Framework\\Web\\Controller', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.import', editor.document.uri);
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use Framework\\Web\\Controller;'));
        assert.ok(text.includes('class Foo extends Controller {}'));
    });

    test('import command resolves classes from vendor excluded from background indexing', async () => {
        const className = `FallbackController${Date.now()}`;
        await openWorkspaceFile(`vendor/framework/${className}.php`, `<?php

namespace Framework\\Web;

class ${className} {}
`);
        const editor = await openWorkspaceFile(`app/${className}Consumer.php`, `<?php

class PageController extends ${className} {}
`);
        const position = editor.document.positionAt(getText(editor).indexOf(className));
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', []);
        await vscode.commands.executeCommand('phpImportHelper.import');
        await wait();

        assert.ok(getText(editor).includes(`use Framework\\Web\\${className};`));
    });

    test('import command prefers built-in classes over cached workspace matches', async () => {
        const editor = await openPhpEditor(`<?php

class Foo {
    /**
     * @throws JsonException
     */
    public function run(): void {}
}
`);
        const position = editor.document.positionAt(getText(editor).indexOf('JsonException'));
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            {
                className: 'JsonException',
                fqcn: 'ToolPrefix202605\\Vendor\\Utils\\JsonException',
                uri: editor.document.uri,
            },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.import');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use JsonException;'));
        assert.ok(!text.includes('ToolPrefix202605\\Vendor\\Utils\\JsonException'));
    });

    test('import command imports selected fully qualified class without cache lookup', async () => {
        const editor = await openPhpEditor(`<?php

class Foo {
    public function show(): void {
        new \\App\\Http\\Request();
    }
}
`);
        const fqcnOffset = getText(editor).indexOf('\\App\\Http\\Request') + 6;
        const position = editor.document.positionAt(fqcnOffset);
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('phpImportHelper.import');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use App\\Http\\Request;'));
        assert.ok(text.includes('new Request();'));
        assert.ok(!text.includes('new \\App\\Http\\Request();'));
    });

    test('import command shortens selected qualified PHPDoc name already imported', async () => {
        const editor = await openPhpEditor(`<?php

use App\\Models\\MediaAsset;

/**
 * @var App\\Models\\MediaAsset $mediaModel
 */
`);
        const fqcnOffset = getText(editor).lastIndexOf('App\\Models\\MediaAsset') + 18;
        const position = editor.document.positionAt(fqcnOffset);
        editor.selection = new vscode.Selection(position, position);

        await vscode.commands.executeCommand('phpImportHelper.import');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use App\\Models\\MediaAsset;'));
        assert.ok(text.includes('@var MediaAsset $mediaModel'));
        assert.strictEqual((text.match(/App\\Models\\MediaAsset/g) ?? []).length, 1);
    });

    test('expand command expands multiple selections', async () => {
        const editor = await openPhpEditor(`<?php

class Foo extends Controller {
    public function show(Request $request): Response {}
}
`);
        editor.selections = ['Controller', 'Request', 'Response'].map((className) => {
            const position = editor.document.positionAt(getText(editor).indexOf(className));
            return new vscode.Selection(position, position);
        });

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Controller', fqcn: 'App\\Http\\Controller', uri: editor.document.uri },
            { className: 'Request', fqcn: 'App\\Http\\Request', uri: editor.document.uri },
            { className: 'Response', fqcn: 'App\\Http\\Response', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.expand');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('\\App\\Http\\Controller'));
        assert.ok(text.includes('\\App\\Http\\Request'));
        assert.ok(text.includes('\\App\\Http\\Response'));
    });

    test('import all command imports unique unresolved classes and cleans existing FQCN aliases', async () => {
        const editor = await openPhpEditor(`<?php

use Framework\\Http\\Client as cl;

class Foo {
    public function show(Request $request): Response {
        return new \\Framework\\Http\\Client();
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
        assert.strictEqual((text.match(/Framework\\Http\\Client/g) ?? []).length, 1);
    });

    test('import all skips ambiguous unresolved classes', async () => {
        const editor = await openPhpEditor(`<?php

class Foo extends Request {}
`);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Request', fqcn: 'App\\Http\\Request', uri: editor.document.uri },
            { className: 'Request', fqcn: 'Vendor\\Http\\Request', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.importAll');
        await wait();

        assert.ok(!getText(editor).includes('use App\\Http\\Request;'));
        assert.ok(!getText(editor).includes('use Vendor\\Http\\Request;'));
    });

    test('import all skips same-namespace classes', async () => {
        const editor = await openPhpEditor(`<?php

namespace App\\Feature;

abstract class FeatureController extends FeatureBase {}
`);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'FeatureBase', fqcn: 'App\\Feature\\FeatureBase', uri: editor.document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.importAll');
        await wait();

        assert.ok(!getText(editor).includes('use App\\Feature\\FeatureBase;'));
    });

    test('import all imports fully qualified PHPDoc types', async () => {
        const editor = await openPhpEditor(`<?php

class Foo {
    /**
     * @return string|\\Framework\\Http\\Response
     * @throws \\Framework\\Http\\ResourceNotFoundException if the model cannot be found
     */
    public function run() {}
}
`);

        await vscode.commands.executeCommand('phpImportHelper.importAll');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use Framework\\Http\\ResourceNotFoundException;'));
        assert.ok(text.includes('use Framework\\Http\\Response;'));
        assert.ok(text.includes('@return string|Response'));
        assert.ok(text.includes('@throws ResourceNotFoundException if the model cannot be found'));
    });

    test('import all imports fully qualified PHPDoc types inside shapes and generics', async () => {
        const editor = await openPhpEditor(`<?php

class Foo {
    /**
     * @return array{response: \\Framework\\Http\\Response, errors?: list<\\Framework\\Http\\ResourceNotFoundException>}
     */
    public function run() {}
}
`);

        await vscode.commands.executeCommand('phpImportHelper.importAll');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use Framework\\Http\\ResourceNotFoundException;'));
        assert.ok(text.includes('use Framework\\Http\\Response;'));
        assert.ok(text.includes('@return array{response: Response, errors?: list<ResourceNotFoundException>}'));
    });

    test('import all shortens qualified PHPDoc names that are already imported', async () => {
        const editor = await openPhpEditor(`<?php

use App\\Models\\MediaAsset;

/**
 * @var App\\Models\\MediaAsset $mediaModel
 */
`);

        await vscode.commands.executeCommand('phpImportHelper.importAll');
        await wait();

        const text = getText(editor);
        assert.ok(text.includes('use App\\Models\\MediaAsset;'));
        assert.ok(text.includes('@var MediaAsset $mediaModel'));
        assert.strictEqual((text.match(/App\\Models\\MediaAsset/g) ?? []).length, 1);
    });

    test('generate namespace inserts namespace from nearest composer json', async () => {
        await vscode.workspace.fs.createDirectory(
            testFixtureRoot()
        );
        await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(testFixtureRoot(), 'composer.json'),
            Buffer.from(JSON.stringify({ autoload: { 'psr-4': { 'Root\\': 'root/' } } }), 'utf8')
        );
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(testFixtureRoot(), 'package')
        );
        await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(testFixtureRoot(), 'package', 'composer.json'),
            Buffer.from(JSON.stringify({ autoload: { 'psr-4': { 'Package\\': 'src/' } } }), 'utf8')
        );
        const editor = await openWorkspaceFile('package/src/Http/Controller.php', `<?php

class Controller {}
`);

        await vscode.commands.executeCommand('phpImportHelper.generateNamespace');
        await wait();

        assert.ok(getText(editor).includes('namespace Package\\Http;'));
        assert.ok(!getText(editor).includes('namespace Root\\'));
    });

    test('generate namespace replaces existing namespace', async () => {
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(testFixtureRoot(), 'replace')
        );
        await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(testFixtureRoot(), 'replace', 'composer.json'),
            Buffer.from(JSON.stringify({ autoload: { 'psr-4': { 'App\\': 'src/' } } }), 'utf8')
        );
        const editor = await openWorkspaceFile('replace/src/Model/User.php', `<?php

namespace Old\\Name;

class User {}
`);

        await vscode.commands.executeCommand('phpImportHelper.generateNamespace');
        await wait();

        assert.ok(getText(editor).includes('namespace App\\Model;'));
        assert.ok(!getText(editor).includes('namespace Old\\Name;'));
    });
});
