import * as assert from 'assert';
import type * as vscode from 'vscode';
import { DeclarationParser } from '../../core/DeclarationParser';
import type { NamespaceCache } from '../../core/NamespaceCache';
import { PhpClassDetector } from '../../core/PhpClassDetector';
import { AutoImportOnSave } from '../../features/AutoImportOnSave';
import type { ResolvedNamespace } from '../../types';

function documentWithText(text: string): vscode.TextDocument {
    return {
        getText: () => text,
    } as vscode.TextDocument;
}

function cacheWith(entries: Record<string, ResolvedNamespace[]>): NamespaceCache {
    return {
        resolve: (className: string) => entries[className] ?? [],
    } as unknown as NamespaceCache;
}

suite('AutoImportOnSave', () => {
    const parser = new DeclarationParser();
    const detector = new PhpClassDetector();

    test('imports uniquely resolved detected classes', () => {
        const cache = cacheWith({
            Request: [{ fqcn: 'App\\Http\\Request', source: 'project' }],
        });
        const autoImport = new AutoImportOnSave(detector, parser, cache);

        const text = autoImport.computeText(documentWithText(`<?php

class Foo {
    public function show(Request $request): void {}
}
`));

        assert.ok(text.includes('use App\\Http\\Request;'));
    });

    test('skips ambiguous classes on save', () => {
        const cache = cacheWith({
            Request: [
                { fqcn: 'App\\Http\\Request', source: 'project' },
                { fqcn: 'Vendor\\Http\\Request', source: 'vendor' },
            ],
        });
        const autoImport = new AutoImportOnSave(detector, parser, cache);

        const text = autoImport.computeText(documentWithText(`<?php

class Foo {
    public function show(Request $request): void {}
}
`));

        assert.ok(!text.includes('use App\\Http\\Request;'));
        assert.ok(!text.includes('use Vendor\\Http\\Request;'));
    });

    test('does not import same-namespace classes on save', () => {
        const cache = cacheWith({
            CRMSelenium: [{ fqcn: 'CRM\\CRMSelenium', source: 'project' }],
        });
        const autoImport = new AutoImportOnSave(detector, parser, cache);

        const text = autoImport.computeText(documentWithText(`<?php

namespace CRM;

abstract class StripChatParent extends CRMSelenium {}
`));

        assert.ok(!text.includes('use CRM\\CRMSelenium;'));
    });

    test('does not duplicate already imported classes', () => {
        const cache = cacheWith({
            Request: [{ fqcn: 'App\\Http\\Request', source: 'project' }],
        });
        const autoImport = new AutoImportOnSave(detector, parser, cache);

        const text = autoImport.computeText(documentWithText(`<?php

use App\\Http\\Request;

class Foo {
    public function show(Request $request): void {}
}
`));

        assert.strictEqual((text.match(/use App\\Http\\Request;/g) ?? []).length, 1);
    });

    test('replaces imported fully qualified classes with existing aliases', () => {
        const cache = cacheWith({});
        const autoImport = new AutoImportOnSave(detector, parser, cache);

        const text = autoImport.computeText(documentWithText(`<?php

use yii\\httpclient\\Client as cl;

class Foo {
    public function run(): void {
        new \\yii\\httpclient\\Client();
    }
}
`));

        assert.ok(text.includes('new cl()'));
    });

    test('imports fully qualified PHPDoc types on save', () => {
        const cache = cacheWith({});
        const autoImport = new AutoImportOnSave(detector, parser, cache);

        const text = autoImport.computeText(documentWithText(`<?php

class Foo {
    /**
     * @return string|\\yii\\web\\Response
     * @throws \\yii\\web\\NotFoundHttpException if the model cannot be found
     */
    public function run() {}
}
`));

        assert.ok(text.includes('use yii\\web\\NotFoundHttpException;'));
        assert.ok(text.includes('use yii\\web\\Response;'));
        assert.ok(text.includes('@return string|Response'));
        assert.ok(text.includes('@throws NotFoundHttpException if the model cannot be found'));
    });
});
