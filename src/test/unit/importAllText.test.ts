import * as assert from 'assert';
import { DeclarationParser } from '../../core/DeclarationParser';
import { computeImportAllText } from '../../core/importAllText';
import type { NamespaceCache } from '../../core/NamespaceCache';
import { PhpClassDetector } from '../../core/PhpClassDetector';
import type { ResolvedNamespace } from '../../types';

function cacheWith(entries: Record<string, ResolvedNamespace[]>): NamespaceCache {
    return {
        resolve: (className: string) => entries[className] ?? [],
    } as unknown as NamespaceCache;
}

suite('importAllText', () => {
    const parser = new DeclarationParser();
    const detector = new PhpClassDetector();

    test('imports fully qualified runtime class references and shortens usages', () => {
        const text = computeImportAllText(
            `<?php

namespace backend\\controllers;

use yii\\filters\\VerbFilter;

class AccessRedditController
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
            cacheWith({})
        );

        assert.ok(text.includes('use yii\\filters\\AccessControl;'));
        assert.ok(text.includes("'class' => AccessControl::class"));
        assert.strictEqual((text.match(/yii\\filters\\AccessControl/g) ?? []).length, 1);
    });

    test('does not import fully qualified built-in runtime classes', () => {
        const text = computeImportAllText(
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
            cacheWith({})
        );

        assert.ok(!text.includes('use Exception;'));
        assert.ok(text.includes('throw new \\Exception('));
    });
});
