import * as assert from 'assert';
import { DeclarationParser } from '../../core/DeclarationParser';
import { computeImportAllText } from '../../core/importAllText';
import { PhpClassDetector } from '../../core/PhpClassDetector';
import type { ResolvedNamespace } from '../../types';

function resolverWith(entries: Record<string, ResolvedNamespace[]>): {
    resolve: (className: string) => Promise<ResolvedNamespace[]>;
} {
    return {
        resolve: async (className: string) => entries[className] ?? [],
    };
}

suite('importAllText', () => {
    const parser = new DeclarationParser();
    const detector = new PhpClassDetector();

    test('imports fully qualified runtime class references and shortens usages', async () => {
        const text = await computeImportAllText(
            `<?php

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
`,
            parser,
            detector,
            resolverWith({})
        );

        assert.ok(text.includes('use yii\\filters\\AccessControl;'));
        assert.ok(text.includes("'class' => AccessControl::class"));
        assert.strictEqual((text.match(/yii\\filters\\AccessControl/g) ?? []).length, 1);
    });

    test('does not import fully qualified built-in runtime classes', async () => {
        const text = await computeImportAllText(
            `<?php

class Foo
{
    public function fail(): void
    {
        throw new \\Exception('boom');
    }
}
`,
            parser,
            detector,
            resolverWith({})
        );

        assert.ok(!text.includes('use Exception;'));
        assert.ok(text.includes('throw new \\Exception('));
    });

    test('imports namespace-qualified PHPDoc types in global scripts', async () => {
        const text = await computeImportAllText(
            `<?php
/**
 * @var vendor\\Package\\ViewModel $model
 */
?>
<?= Widget::render($model) ?>
`,
            parser,
            detector,
            resolverWith({
                Widget: [{ fqcn: 'App\\Ui\\Widget', source: 'project' }],
            })
        );

        assert.ok(text.includes('use App\\Ui\\Widget;'));
        assert.ok(text.includes('use vendor\\Package\\ViewModel;'));
        assert.ok(text.includes('@var ViewModel $model'));
    });

    test('imports a class resolved by asynchronous fallback', async () => {
        const text = await computeImportAllText(
            `<?php

class PageController extends Controller {}
`,
            parser,
            detector,
            {
                resolve: async (className) => className === 'Controller'
                    ? [{ fqcn: 'Framework\\Web\\Controller', source: 'vendor' }]
                    : [],
            }
        );

        assert.ok(text.includes('use Framework\\Web\\Controller;'));
    });
});
