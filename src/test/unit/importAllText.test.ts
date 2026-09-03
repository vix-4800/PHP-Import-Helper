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

use Framework\\Filters\\RequestFilter;

class AccessPolicyController
{
    public function behaviors()
    {
        return [
            'access' => [
                'class' => \\Framework\\Filters\\AccessPolicy::class,
            ],
            'verbs' => [
                'class' => RequestFilter::class,
            ],
        ];
    }
}
`,
            parser,
            detector,
            resolverWith({})
        );

        assert.ok(text.includes('use Framework\\Filters\\AccessPolicy;'));
        assert.ok(text.includes("'class' => AccessPolicy::class"));
        assert.strictEqual((text.match(/Framework\\Filters\\AccessPolicy/g) ?? []).length, 1);
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

    test('ignores namespace-qualified types in ordinary block comments', async () => {
        const text = await computeImportAllText(
            `<?php
/* @var vendor\\Package\\ViewModel $model */
/* @var HiddenModel $hidden */
`,
            parser,
            detector,
            resolverWith({
                HiddenModel: [{ fqcn: 'App\\Models\\HiddenModel', source: 'project' }],
            })
        );

        assert.ok(!text.includes('use vendor\\Package\\ViewModel;'));
        assert.ok(!text.includes('use App\\Models\\HiddenModel;'));
        assert.ok(text.includes('/* @var vendor\\Package\\ViewModel $model */'));
        assert.ok(text.includes('/* @var HiddenModel $hidden */'));
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

    test('preserves the used class case when adding a missing import', async () => {
        const text = await computeImportAllText(
            `<?php

class Consumer
{
    public function create(): FirstUserclass {}
}
`,
            parser,
            detector,
            resolverWith({
                FirstUserclass: [{ fqcn: 'App\\Models\\FirstUserClass', source: 'project' }],
            })
        );

        assert.ok(text.includes('use App\\Models\\FirstUserclass;'));
        assert.ok(text.includes('create(): FirstUserclass'));
        assert.ok(!text.includes('FirstUserClass'));
    });

    test('normalizes imported class names and all usages when case fixing is enabled', async () => {
        const text = await computeImportAllText(
            `<?php

use App\\Models\\{FirstUserclass, Other};

class Consumer
{
    public function create(FirstUserclass $user): FirstUserclass
    {
        return new FirstUserclass();
    }
}
`,
            parser,
            detector,
            resolverWith({
                FirstUserclass: [{ fqcn: 'App\\Models\\FirstUserClass', source: 'project' }],
            }),
            undefined,
            {
                autoAliasConflicts: false,
                aliasPrefixes: ['Base', 'Core'],
                autoFixCase: true,
            }
        );

        assert.ok(text.includes('use App\\Models\\{FirstUserClass, Other};'));
        assert.strictEqual((text.match(/FirstUserclass/g) ?? []).length, 0);
        assert.strictEqual((text.match(/FirstUserClass/g) ?? []).length, 4);
    });

    test('normalizes same-namespace class usages when case fixing is enabled', async () => {
        const text = await computeImportAllText(
            `<?php

namespace App\\Feature;

class PrimaryService
{
    public function create(RelatedServicE $service): RelatedServicE
    {
        return new RelatedServicE();
    }
}
`,
            parser,
            detector,
            resolverWith({
                RelatedServicE: [{
                    fqcn: 'App\\Feature\\RelatedService',
                    source: 'project',
                }],
            }),
            undefined,
            {
                autoAliasConflicts: false,
                aliasPrefixes: ['Base', 'Core'],
                autoFixCase: true,
            }
        );

        assert.ok(!text.includes('use App\\Feature\\RelatedService;'));
        assert.strictEqual((text.match(/RelatedServicE/g) ?? []).length, 0);
        assert.strictEqual((text.match(/RelatedService/g) ?? []).length, 3);
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
use Other\\Exception as DatabaseException;

class FrameworkDatabaseException {}

class Consumer
{
    public function fail(): void
    {
        throw new \\Framework\\Database\\Exception();
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

        assert.ok(text.includes('use Framework\\Database\\Exception as BaseException;'));
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
