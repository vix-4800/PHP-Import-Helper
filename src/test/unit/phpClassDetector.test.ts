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

    test('ignores URLs in PHPDoc see tags', () => {
        const result = detector.detectAll(`<?php
/**
 * @see https://example.com/acme/package/docs/validation/rules.md
 */
function rules(): array {}
`);

        assert.deepStrictEqual(result, []);
    });

    test('detects class references in PHPDoc see tags', () => {
        const result = detector.detectAll(`<?php
/**
 * @see RelatedClass
 * @see \\App\\Docs\\FullReference
 */
function rules(): array {}
`);

        assert.deepStrictEqual(result, ['RelatedClass']);
        assert.deepStrictEqual(detector.detectFullyQualifiedPhpDocReferences(`<?php
/**
 * @see RelatedClass
 * @see \\App\\Docs\\FullReference
 */
function rules(): array {}
`).map((item) => item.rawName), ['App\\Docs\\FullReference']);
    });

    test('ignores method names and variable names in PHPDoc method tags', () => {
        const result = detector.detectAll(`<?php
/**
 * @method Collection<User> users(Request $request)
 */
class UserRepository {}
`);

        assert.deepStrictEqual(result, ['Collection', 'User', 'Request']);
    });

    test('ignores PHPDoc generic utility names while detecting generic class references', () => {
        const result = detector.detectAll(`<?php
/**
 * @param class-string<Foo> $class
 * @param list<Bar> $items
 * @param array-key $key
 * @param value-of<Status> $status
 * @param key-of<Shape> $shapeKey
 */
function hydrate($class, $items, $key, $status, $shapeKey): void {}
`);

        assert.deepStrictEqual(result, ['Foo', 'Bar', 'Status', 'Shape']);
    });

    test('ignores PHPDoc array shape keys while detecting value types', () => {
        const result = detector.detectAll(`<?php
/**
 * @param array{foo: Foo, bar?: Bar, nested: array{baz: Baz}, 0: NumericSlot} $data
 */
function hydrate(array $data): void {}
`);

        assert.deepStrictEqual(result, ['Foo', 'Bar', 'Baz', 'NumericSlot']);
    });

    test('detects multiline PHPDoc tag type expressions', () => {
        const result = detector.detectAll(`<?php
/**
 * @param array{
 *     user: User,
 *     posts: list<Post>
 * } $data
 * @return Collection<
 *     Response
 * >
 */
function hydrate(array $data) {}
`);

        assert.deepStrictEqual(result, ['User', 'Post', 'Collection', 'Response']);
    });

    test('detects PHPDoc callable argument and return types', () => {
        const result = detector.detectAll(`<?php
/**
 * @param callable(Foo): Bar $factory
 * @param Closure(Baz): Qux $closure
 */
function hydrate(callable $factory, Closure $closure): void {}
`);

        assert.deepStrictEqual(result, ['Foo', 'Bar', 'Baz', 'Qux']);
    });

    test('ignores PHPDoc pseudo self references', () => {
        const result = detector.detectAll(`<?php
/**
 * @return $this|self|static|parent
 */
function fluent() {}
`);

        assert.deepStrictEqual(result, []);
    });

    test('ignores free-text descriptions after PHPDoc return and throws types', () => {
        const result = detector.detectAll(`<?php
/**
 * @return Alert the loaded model
 * @throws NotFoundHttpException if the model cannot be found
 */
function findModel(): Alert {}
`);

        assert.deepStrictEqual(result, ['Alert', 'NotFoundHttpException']);
    });

    test('ignores PHPDoc var descriptions without variable names and unsupported tags', () => {
        const result = detector.detectAll(`<?php
class Queue {
    /**
     * Message Group ID for FIFO queues.
     * @var string
     * @since 2.2.1
     */
    public $messageGroupId = 'default';

    /**
     * @var string command class name
     * @inheritdoc
     */
    public $commandClass = Command::class;

    /**
     * Json serializer by default.
     * @inheritdoc
     */
    public $serializer = JsonSerializer::class;
}
`);

        assert.deepStrictEqual(result, ['Command', 'JsonSerializer']);
    });

    test('does not append unsupported PHPDoc tags to previous type tags', () => {
        const result = detector.detectAll(`<?php
/**
 * @return Response
 * @since 1.0
 * @inheritdoc
 * @customTag HiddenType
 */
function run() {}
`);

        assert.deepStrictEqual(result, ['Response']);
    });

    test('detects PHPDoc var type when description has class-like words and no variable name', () => {
        const result = detector.detectAll(`<?php
/**
 * @var Collection<User> command class name
 */
$items = [];
`);

        assert.deepStrictEqual(result, ['Collection', 'User']);
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

    test('keeps namespace-prefixed PHPDoc references as import usages', () => {
        const text = `<?php

use App\\Models\\User;

class Foo {
    /** @return User\\Profile */
    public function profile() {}
}
`;

        assert.deepStrictEqual(detector.detectAll(text), []);
        assert.deepStrictEqual(detector.detectImportUsages(text), ['User']);
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

    test('keeps PHPDoc built-in exceptions as import usages but not import candidates', () => {
        const text = `<?php

class Foo {
    /**
     * @throws JsonException
     */
    public function run(): void {}
}
`;

        assert.deepStrictEqual(detector.detectAll(text), []);
        assert.deepStrictEqual(detector.detectImportUsages(text), ['JsonException']);
    });

    test('keeps imported built-ins as import usages in PHPDoc and runtime code', () => {
        const text = `<?php

use Exception;
use SplFileInfo;

class Foo {
    /**
     * @throws Exception
     */
    public function run(string $src): SplFileInfo {
        try {
            return new SplFileInfo($src);
        } catch (Exception $e) {
            throw $e;
        }
    }
}
`;

        assert.deepStrictEqual(detector.detectAll(text), []);
        assert.deepStrictEqual(detector.detectImportUsages(text), ['Exception', 'SplFileInfo']);
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

    test('ignores method declaration names and params while fallback syntax is active', () => {
        const result = detector.detectAll(`<?php

namespace App\\Feature;

abstract class FeatureController extends FeatureBase
{
    protected function banner(bool $useClickAccept = false)
    {
    }

    public function broken(): void
    {
        $driver = new LegacyDriver;
    }
}
`);

        assert.ok(result.includes('FeatureBase'));
        assert.ok(result.includes('LegacyDriver'));
        assert.ok(!result.includes('function'));
        assert.ok(!result.includes('banner'));
        assert.ok(!result.includes('useClickAccept'));
    });

    test('ignores method declarations and ternary array values in fallback mode', () => {
        class FallbackParser extends PhpAstParser {
            public override parse(code: string, filename?: string) {
                const document = super.parse(code, filename);

                return {
                    ...document,
                    errors: [...document.errors, { message: 'Forced fallback' }],
                };
            }
        }

        const fallbackDetector = new PhpClassDetector(new FallbackParser());
        const result = fallbackDetector.detectAll(`<?php

class SupportPanel {
    public static function createLinkToInbox(int $inbox_id, int $queue_id): bool
    {
        return new Query()->createCommand();
    }

    public function photos(): array
    {
        $response[] = [
            'caption' => $width > 0 ? $width . 'x' . $height : 'Not image',
            'filename' => $photo->url,
            'downloadUrl' => Url::to(['file2', 'filename' => $photo->url]),
            'url' => Url::to(['xhr-delete-file', 'id' => $itemId]),
        ];
    }
}
`);

        assert.ok(result.includes('Query'));
        assert.ok(result.includes('Url'));
        for (const name of ['function', 'createLinkToInbox', 'i', 'x', 'f', 'to', 'u', 'url']) {
            assert.ok(!result.includes(name), `${name} should be ignored`);
        }
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

    test('does not import classes referenced only by fully qualified PHPDoc types', () => {
        const text = `<?php

/**
 * @return string|\\yii\\web\\Response
 */
function actionCreate() {}
`;

        assert.deepStrictEqual(detector.detectAll(text), []);
        assert.deepStrictEqual(detector.detectFullyQualifiedReferences(text).map((item) => item.rawName), [
            'yii\\web\\Response',
        ]);
    });

    test('derives import candidates and usages from one reference pass', () => {
        const text = `<?php

use App\\Models\\User;

class Foo extends Controller {
    public function run(User $user): Response {
        return new Response();
    }
}
`;

        const references = detector.detectReferences(text);

        assert.deepStrictEqual(
            detector.filterImportCandidates(references).map((item) => item.name).sort(),
            ['Controller', 'Response', 'Response', 'User']
        );
        assert.deepStrictEqual(
            detector.extractImportUsages(references).sort(),
            ['Controller', 'Response', 'User']
        );
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
