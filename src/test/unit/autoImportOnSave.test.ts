import * as assert from 'assert';
import type * as vscode from 'vscode';
import { DeclarationParser } from '../../core/DeclarationParser';
import { PhpClassDetector } from '../../core/PhpClassDetector';
import { AutoImportOnSave } from '../../features/AutoImportOnSave';
import type { ResolvedNamespace } from '../../types';

function documentWithText(text: string): vscode.TextDocument {
    return {
        getText: () => text,
    } as vscode.TextDocument;
}

function resolverWith(entries: Record<string, ResolvedNamespace[]>): {
    resolve: (className: string) => Promise<ResolvedNamespace[]>;
} {
    return {
        resolve: async (className: string) => entries[className] ?? [],
    };
}

suite('AutoImportOnSave', () => {
    const parser = new DeclarationParser();
    const detector = new PhpClassDetector();

    test('imports uniquely resolved detected classes', async () => {
        const resolver = resolverWith({
            Request: [{ fqcn: 'App\\Http\\Request', source: 'project' }],
        });
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

class Foo {
    public function show(Request $request): void {}
}
`));

        assert.ok(text.includes('use App\\Http\\Request;'));
    });

    test('skips ambiguous classes on save', async () => {
        const resolver = resolverWith({
            Request: [
                { fqcn: 'App\\Http\\Request', source: 'project' },
                { fqcn: 'Vendor\\Http\\Request', source: 'vendor' },
            ],
        });
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

class Foo {
    public function show(Request $request): void {}
}
`));

        assert.ok(!text.includes('use App\\Http\\Request;'));
        assert.ok(!text.includes('use Vendor\\Http\\Request;'));
    });

    test('does not import same-namespace classes on save', async () => {
        const resolver = resolverWith({
            FeatureBase: [{ fqcn: 'App\\Feature\\FeatureBase', source: 'project' }],
        });
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

namespace App\\Feature;

abstract class FeatureController extends FeatureBase {}
`));

        assert.ok(!text.includes('use App\\Feature\\FeatureBase;'));
    });

    test('does not duplicate already imported classes', async () => {
        const resolver = resolverWith({
            Request: [{ fqcn: 'App\\Http\\Request', source: 'project' }],
        });
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

use App\\Http\\Request;

class Foo {
    public function show(Request $request): void {}
}
`));

        assert.strictEqual((text.match(/use App\\Http\\Request;/g) ?? []).length, 1);
    });

    test('shortens already imported PHPDoc qualified names on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

use App\\Models\\MediaAsset;

/**
 * @var App\\Models\\MediaAsset $mediaModel
 */
`));

        assert.ok(text.includes('@var MediaAsset $mediaModel'));
        assert.strictEqual((text.match(/use App\\Models\\MediaAsset;/g) ?? []).length, 1);
        assert.strictEqual((text.match(/App\\Models\\MediaAsset/g) ?? []).length, 1);
    });

    test('replaces imported fully qualified classes with existing aliases', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

use yii\\httpclient\\Client as cl;

class Foo {
    public function run(): void {
        new \\yii\\httpclient\\Client();
    }
}
`));

        assert.ok(text.includes('new cl()'));
    });

    test('imports fully qualified runtime classes on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

namespace backend\\controllers;

use yii\\filters\\VerbFilter;

class AccessPolicyController
{
    public function behaviors()
    {
        return [
            'access' => [
                'class' => \\yii\\filters\\AccessControl::class,
            ],
            'verbs' => [
                'class' => VerbFilter::class,
            ],
        ];
    }
}
`));

        assert.ok(text.includes('use yii\\filters\\AccessControl;'));
        assert.ok(text.includes("'class' => AccessControl::class"));
        assert.strictEqual((text.match(/yii\\filters\\AccessControl/g) ?? []).length, 1);
    });

    test('imports fully qualified PHPDoc types on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

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

    test('imports fully qualified PHPDoc types inside shapes and generics on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

class Foo {
    /**
     * @return array{response: \\yii\\web\\Response, errors?: list<\\yii\\web\\NotFoundHttpException>}
     */
    public function run() {}
}
`));

        assert.ok(text.includes('use yii\\web\\NotFoundHttpException;'));
        assert.ok(text.includes('use yii\\web\\Response;'));
        assert.ok(text.includes('@return array{response: Response, errors?: list<NotFoundHttpException>}'));
    });

    test('imports fully qualified multiline PHPDoc types inside shapes and generics on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

class Foo {
    /**
     * @return array{
     *     response: \\yii\\web\\Response,
     *     errors?: list<\\yii\\web\\NotFoundHttpException>
     * }
     */
    public function run() {}
}
`));

        assert.ok(text.includes('use yii\\web\\NotFoundHttpException;'));
        assert.ok(text.includes('use yii\\web\\Response;'));
        assert.ok(text.includes('response: Response'));
        assert.ok(text.includes('errors?: list<NotFoundHttpException>'));
    });
});
