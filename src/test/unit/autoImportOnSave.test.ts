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

use Framework\\Http\\Client as cl;

class Foo {
    public function run(): void {
        new \\Framework\\Http\\Client();
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
`));

        assert.ok(text.includes('use Framework\\Filters\\AccessPolicy;'));
        assert.ok(text.includes("'class' => AccessPolicy::class"));
        assert.strictEqual((text.match(/Framework\\Filters\\AccessPolicy/g) ?? []).length, 1);
    });

    test('imports conflicting fully qualified classes with aliases when enabled', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeTextForText(
            `<?php

use First\\MyClass;

class Consumer {
    public function create(): object {
        return new \\Second\\MyClass();
    }
}
`,
            undefined,
            {
                autoAliasConflicts: true,
                aliasPrefixes: ['Base', 'Core'],
            }
        );

        assert.ok(text.includes('use Second\\MyClass as SecondMyClass;'));
        assert.ok(text.includes('return new SecondMyClass();'));
    });

    test('aliases every unimported fully qualified class in the same conflict group', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeTextForText(
            `<?php

namespace App;

final class Consumer
{
    public function first(): void
    {
        throw new \\Exception('first');
    }

    public function second(): void
    {
        throw new \\Vendor\\Package\\Exception('second');
    }

    public function third(): void
    {
        throw new \\Framework\\Database\\Exception('third');
    }
}
`,
            undefined,
            {
                autoAliasConflicts: true,
                aliasPrefixes: ['Base', 'Core'],
            }
        );

        assert.ok(text.includes('use Exception as BaseException;'));
        assert.ok(text.includes('use Vendor\\Package\\Exception as PackageException;'));
        assert.ok(text.includes('use Framework\\Database\\Exception as DatabaseException;'));
        assert.ok(text.includes("throw new BaseException('first');"));
        assert.ok(text.includes("throw new PackageException('second');"));
        assert.ok(text.includes("throw new DatabaseException('third');"));
    });

    test('imports fully qualified PHPDoc types on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

class Foo {
    /**
     * @return string|\\Framework\\Http\\Response
     * @throws \\Framework\\Http\\ResourceNotFoundException if the model cannot be found
     */
    public function run() {}
}
`));

        assert.ok(text.includes('use Framework\\Http\\ResourceNotFoundException;'));
        assert.ok(text.includes('use Framework\\Http\\Response;'));
        assert.ok(text.includes('@return string|Response'));
        assert.ok(text.includes('@throws ResourceNotFoundException if the model cannot be found'));
    });

    test('imports fully qualified PHPDoc types inside shapes and generics on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

class Foo {
    /**
     * @return array{response: \\Framework\\Http\\Response, errors?: list<\\Framework\\Http\\ResourceNotFoundException>}
     */
    public function run() {}
}
`));

        assert.ok(text.includes('use Framework\\Http\\ResourceNotFoundException;'));
        assert.ok(text.includes('use Framework\\Http\\Response;'));
        assert.ok(text.includes('@return array{response: Response, errors?: list<ResourceNotFoundException>}'));
    });

    test('imports fully qualified multiline PHPDoc types inside shapes and generics on save', async () => {
        const resolver = resolverWith({});
        const autoImport = new AutoImportOnSave(detector, parser, resolver);

        const text = await autoImport.computeText(documentWithText(`<?php

class Foo {
    /**
     * @return array{
     *     response: \\Framework\\Http\\Response,
     *     errors?: list<\\Framework\\Http\\ResourceNotFoundException>
     * }
     */
    public function run() {}
}
`));

        assert.ok(text.includes('use Framework\\Http\\ResourceNotFoundException;'));
        assert.ok(text.includes('use Framework\\Http\\Response;'));
        assert.ok(text.includes('response: Response'));
        assert.ok(text.includes('errors?: list<ResourceNotFoundException>'));
    });
});
