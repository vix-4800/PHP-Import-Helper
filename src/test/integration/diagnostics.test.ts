import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiagnosticCode } from '../../types';
import { createPhpDocument, wait } from './helper';

suite('diagnostics and code actions', () => {
    async function diagnosticsFor(content: string): Promise<vscode.Diagnostic[]> {
        const document = await createPhpDocument(content);

        await vscode.commands.executeCommand('phpImportHelper.refreshDiagnostics', document.uri);
        await wait();

        return vscode.languages.getDiagnostics(document.uri);
    }

    function hasDiagnostic(
        diagnostics: vscode.Diagnostic[],
        code: DiagnosticCode,
        text: string
    ): boolean {
        return diagnostics.some((item) => item.code === code && item.message.includes(text));
    }

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

    test('does not provide quick fixes for unrelated diagnostics', async () => {
        const document = await createPhpDocument(`<?php

class Foo {}
`);
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(2, 0, 2, 5),
            'Unrelated diagnostic',
            vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'other-extension';
        diagnostic.code = 'other.code';

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            document.uri,
            new vscode.Range(2, 0, 2, 5),
            vscode.CodeActionKind.QuickFix.value,
        );

        assert.ok(actions?.every((action) => action.diagnostics?.[0] !== diagnostic));
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

    test('does not report lowercase alias usages as unused', async () => {
        const diagnostics = await diagnosticsFor(`<?php

use yii\\httpclient\\Client as cl;

class Foo {
    public function run(): void {
        cl::create();
        new cl();
    }
}
`);

        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotUsed, 'cl'));
    });

    test('does not report classes imported by grouped use statements', async () => {
        const diagnostics = await diagnosticsFor(`<?php

use App\\Models\\{User, Post};

class Foo {
    public function user(): User {}
    public function post(): Post {}
}
`);

        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'User'));
        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'Post'));
        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotUsed, 'User'));
        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotUsed, 'Post'));
    });

    test('ignores class-like words in strings comments and PHPDoc free text', async () => {
        const diagnostics = await diagnosticsFor(`<?php

/**
 * Free text mentions HiddenDocService and new HiddenFactory().
 */
class Foo {
    public function run(): void {
        $text = "HiddenStringService";
        // HiddenCommentService::run();
        # HiddenHashCommentService
    }
}
`);

        for (const name of [
            'HiddenDocService',
            'HiddenFactory',
            'HiddenStringService',
            'HiddenCommentService',
            'HiddenHashCommentService',
        ]) {
            assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, name), name);
        }
    });

    test('reports PHPDoc tag types but keeps imported PHPDoc-only usages', async () => {
        const diagnostics = await diagnosticsFor(`<?php

use App\\Models\\ImportedDocType;

class Foo {
    /**
     * @param MissingDocType $missing
     * @return ImportedDocType
     */
    public function run($missing) {}
}
`);

        assert.ok(hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'MissingDocType'));
        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotUsed, 'ImportedDocType'));
    });

    test('does not report same-namespace class when cache has multiple entries', async () => {
        const document = await createPhpDocument(`<?php

namespace App\\Events;

class Listener {
    public function handle(Event $event): void {}
}
`);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Event', fqcn: 'App\\Events\\Event', uri: document.uri },
            { className: 'Event', fqcn: 'Illuminate\\Support\\Facades\\Event', uri: document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.refreshDiagnostics', document.uri);
        await wait();

        const diagnostics = vscode.languages.getDiagnostics(document.uri);

        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'Event'));
    });

    test('does not report built-in or indexed global classes in files without namespace', async () => {
        const document = await createPhpDocument(`<?php

class Foo implements JsonSerializable {
    public function mock(Mockery $mock): RuntimeException {}
}
`);

        await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
            { className: 'Mockery', fqcn: 'Mockery', uri: document.uri },
        ]);
        await vscode.commands.executeCommand('phpImportHelper.refreshDiagnostics', document.uri);
        await wait();

        const diagnostics = vscode.languages.getDiagnostics(document.uri);

        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'JsonSerializable'));
        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'RuntimeException'));
        assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'Mockery'));
    });

    test('reports non-built-in global-looking classes when cache has no global entry', async () => {
        const diagnostics = await diagnosticsFor(`<?php

class Foo {
    public function run(CustomGlobal $value): void {}
}
`);

        assert.ok(hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'CustomGlobal'));
    });

    test('respects ignored classes and highlight toggles', async () => {
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previousIgnoreList = config.get<string[]>('ignoreList', []);
        const previousHighlightNotImported = config.get<boolean>('highlightNotImported', true);
        const previousHighlightNotUsed = config.get<boolean>('highlightNotUsed', true);

        try {
            await config.update('ignoreList', ['IgnoredClass'], vscode.ConfigurationTarget.Global);
            await config.update('highlightNotImported', false, vscode.ConfigurationTarget.Global);
            await config.update('highlightNotUsed', false, vscode.ConfigurationTarget.Global);

            const diagnostics = await diagnosticsFor(`<?php

use App\\Models\\UnusedModel;

class Foo extends IgnoredClass {
    public function run(MissingClass $missing): void {}
}
`);

            assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'IgnoredClass'));
            assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotImported, 'MissingClass'));
            assert.ok(!hasDiagnostic(diagnostics, DiagnosticCode.ClassNotUsed, 'UnusedModel'));
        } finally {
            await config.update('ignoreList', previousIgnoreList, vscode.ConfigurationTarget.Global);
            await config.update('highlightNotImported', previousHighlightNotImported, vscode.ConfigurationTarget.Global);
            await config.update('highlightNotUsed', previousHighlightNotUsed, vscode.ConfigurationTarget.Global);
        }
    });
});
