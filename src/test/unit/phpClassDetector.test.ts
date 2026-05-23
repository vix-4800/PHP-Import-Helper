import * as assert from 'assert';
import { PhpClassDetector, sanitizePhpCode } from '../../core/PhpClassDetector';
import { PhpAstParser } from '../../core/phpParser';

suite('PhpClassDetector', () => {
    const detector = new PhpClassDetector();

    test('detects PHP type references with positions', () => {
        const result = detector.detectAllWithPositions(`<?php

class Foo extends Controller implements JsonSerializable {
    public function show(#[CurrentUser] ?User $user): Response|array {}
}
`);

        const names = result.map((item) => item.name);
        assert.ok(names.includes('Controller'));
        assert.ok(!names.includes('JsonSerializable'));
        assert.ok(names.includes('CurrentUser'));
        assert.ok(names.includes('User'));
        assert.ok(names.includes('Response'));
        assert.ok(!names.includes('array'));
    });

    test('detects PHPDoc tag types but ignores free text', () => {
        const result = detector.detectAll(`<?php
/**
 * Returns Logger based on config
 * @param Request $request
 * @return Collection<User>
 */
function show($request) {}
`);

        assert.ok(result.includes('Request'));
        assert.ok(result.includes('Collection'));
        assert.ok(result.includes('User'));
        assert.ok(!result.includes('Logger'));
    });

    test('detects rich PHPDoc tag type expressions', () => {
        const result = detector.detectAll(`<?php
/**
 * @property-read Profile $profile
 * @method Collection<User> users(Request $request)
 * @mixin QueryBuilder
 * @extends Repository<User>
 * @implements Handler<Request>
 * @see RelatedClass
 */
class UserRepository {}
`);

        for (const name of ['Profile', 'Collection', 'User', 'Request', 'QueryBuilder', 'Repository', 'Handler', 'RelatedClass']) {
            assert.ok(result.includes(name), `${name} missing`);
        }
    });

    test('ignores PHPDoc free-text code patterns and variable names', () => {
        const result = detector.detectAll(`<?php
/**
 * Example: new HiddenService() and Cache::get() in docs.
 * @var VisibleService $service
 */
$service = make();
`);

        assert.deepStrictEqual(result, ['VisibleService']);
    });

    test('detects standalone PHPDoc tags not attached to AST nodes', () => {
        const result = detector.detectAll(`<?php
/**
 * @var StandaloneType $value
 */
$value = make();
`);

        assert.deepStrictEqual(result, ['StandaloneType']);
    });

    test('detects traits, catch types, static calls, and constructors', () => {
        const result = detector.detectAll(`<?php

class Foo {
    use HasFactory, SoftDeletes;

    public function run(): void {
        try {
            $client = new Client();
            Cache::get('x');
        } catch (RuntimeException | DomainException) {
        }
    }
}
`);

        for (const name of ['HasFactory', 'SoftDeletes', 'Client', 'Cache']) {
            assert.ok(result.includes(name), `${name} missing`);
        }
        assert.ok(!result.includes('RuntimeException'));
        assert.ok(!result.includes('DomainException'));
    });

    test('sanitizes strings and comments while preserving attributes and length', () => {
        const text = `<?php
$x = 'new Foo()';
// new Bar()
#[Route]
$y = new Baz();
`;
        const result = sanitizePhpCode(text);

        assert.strictEqual(result.length, text.length);
        assert.ok(!result.includes('Foo'));
        assert.ok(!result.includes('Bar'));
        assert.ok(result.includes('#[Route]'));
        assert.ok(result.includes('Baz'));
    });

    test('ignores heredoc code-like content and PHPDoc template parameter names', () => {
        const result = detector.detectAll(`<?php
/**
 * @template TModel of Model
 * @param TModel $model
 * @return TModel
 */
function hydrate($model): void {
    $sql = <<<SQL
new Hidden()
SQL;
    $real = new Visible();
}
`);

        assert.ok(result.includes('Model'));
        assert.ok(result.includes('Visible'));
        assert.ok(!result.includes('TModel'));
        assert.ok(!result.includes('Hidden'));
    });

    test('detects no-capture catch, DNF types, variadic params, and typed constants', () => {
        const result = detector.detectAll(`<?php

class Foo {
    public const ErrorCode|Status RESULT = null;
    private (Iterator&Countable)|null $items;

    public function merge(Collection ...$collections): (Stringable&Countable)|null
    {
        try {
        } catch (InvalidArgumentException | LogicException) {
        }
    }
}
`);

        for (const name of [
            'ErrorCode',
            'Status',
            'Collection',
        ]) {
            assert.ok(result.includes(name), `${name} missing`);
        }
        for (const name of ['Iterator', 'Countable', 'Stringable', 'InvalidArgumentException', 'LogicException']) {
            assert.ok(!result.includes(name), `${name} should be filtered`);
        }
    });

    test('keeps built-in references as import usages but not import candidates', () => {
        const text = `<?php

class Foo implements JsonSerializable {
    public function run(): RuntimeException {}
}
`;

        assert.deepStrictEqual(detector.detectAll(text), []);
        assert.deepStrictEqual(detector.detectImportUsages(text), ['JsonSerializable', 'RuntimeException']);
    });

    test('detects multiple attributes in one attribute group', () => {
        const result = detector.detectAll(`<?php

#[FirstAttribute, SecondAttribute(options: new AttributeOption())]
class Foo {}
`);

        for (const name of ['FirstAttribute', 'SecondAttribute', 'AttributeOption']) {
            assert.ok(result.includes(name), `${name} missing`);
        }
    });

    test('detects PHP 8.4 asymmetric visibility property types and property hook params', () => {
        const result = detector.detectAll(`<?php

class Foo {
    public private(set) PropertyValue $value {
        set(HookValue $value) => $this->value = $value;
    }
}
`);

        assert.ok(result.includes('PropertyValue'));
        assert.ok(result.includes('HookValue'));
    });

    test('does not detect variable static access or anonymous class expressions', () => {
        const result = detector.detectAll(`<?php

$model::query();
$object = new class {};
$real = new Service();
`);

        assert.deepStrictEqual(result, ['Service']);
    });

    test('does not import classes referenced only by fully qualified names', () => {
        const text = `<?php

class Foo {
    public function run(): \\App\\Services\\Runner {
        return new \\App\\Services\\Runner();
    }
}
`;

        assert.deepStrictEqual(detector.detectAll(text), []);
        assert.deepStrictEqual(detector.detectFullyQualifiedReferences(text).map((item) => item.rawName), [
            'App\\Services\\Runner',
            'App\\Services\\Runner',
        ]);
    });

    test('parses document once per detection pass', () => {
        class CountingParser extends PhpAstParser {
            public count = 0;

            public override parse(code: string, filename?: string) {
                this.count++;

                return super.parse(code, filename);
            }
        }

        const parser = new CountingParser();
        const countingDetector = new PhpClassDetector(parser);

        countingDetector.detectAll('<?php class Foo extends Controller {}');

        assert.strictEqual(parser.count, 1);
    });
});
