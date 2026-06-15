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

    test('imports a conflicting fully qualified class with a namespace alias', async () => {
        const text = await computeImportAllText(
            `<?php

use First\\MyClass;

class Consumer
{
    public function create(): object
    {
        return new \\Second\\MyClass();
    }
}
`,
            parser,
            detector,
            resolverWith({}),
            undefined,
            {
                autoAliasConflicts: true,
                aliasPrefixes: ['Base', 'Core'],
            }
        );

        assert.ok(text.includes('use Second\\MyClass as SecondMyClass;'));
        assert.ok(text.includes('return new SecondMyClass();'));
    });

    test('avoids imported and locally declared names when generating an alias', async () => {
        const text = await computeImportAllText(
            `<?php

use First\\Exception;
use Other\\Exception as DbException;

class YiiDbException {}

class Consumer
{
    public function fail(): void
    {
        throw new \\yii\\db\\Exception();
    }
}
`,
            parser,
            detector,
            resolverWith({}),
            undefined,
            {
                autoAliasConflicts: true,
                aliasPrefixes: ['Base', 'Core'],
            }
        );

        assert.ok(text.includes('use yii\\db\\Exception as BaseException;'));
        assert.ok(text.includes('throw new BaseException();'));
    });

    test('uses one alias for conflicting runtime and PHPDoc references', async () => {
        const text = await computeImportAllText(
            `<?php

use First\\Response;

class Consumer
{
    /**
     * @return \\Vendor\\Http\\Response
     */
    public function create(): \\Vendor\\Http\\Response
    {
        return new \\Vendor\\Http\\Response();
    }
}
`,
            parser,
            detector,
            resolverWith({}),
            undefined,
            {
                autoAliasConflicts: true,
                aliasPrefixes: ['Base', 'Core'],
            }
        );

        assert.strictEqual(
            (text.match(/use Vendor\\Http\\Response as HttpResponse;/g) ?? []).length,
            1
        );
        assert.ok(text.includes('@return HttpResponse'));
        assert.ok(text.includes('function create(): HttpResponse'));
        assert.ok(text.includes('return new HttpResponse();'));
    });

    test('aliases a conflicting fully qualified built-in class', async () => {
        const text = await computeImportAllText(
            `<?php

use App\\JsonException;

class Consumer
{
    public function fail(): void
    {
        throw new \\JsonException();
    }
}
`,
            parser,
            detector,
            resolverWith({}),
            undefined,
            {
                autoAliasConflicts: true,
                aliasPrefixes: ['Base', 'Core'],
            }
        );

        assert.ok(text.includes('use JsonException as BaseJsonException;'));
        assert.ok(text.includes('throw new BaseJsonException();'));
    });

    test('leaves conflicting fully qualified references unchanged when aliases are disabled', async () => {
        const text = await computeImportAllText(
            `<?php

use First\\MyClass;

class Consumer
{
    public function create(): object
    {
        return new \\Second\\MyClass();
    }
}
`,
            parser,
            detector,
            resolverWith({})
        );

        assert.ok(!text.includes('use Second\\MyClass'));
        assert.ok(text.includes('return new \\Second\\MyClass();'));
    });
});
