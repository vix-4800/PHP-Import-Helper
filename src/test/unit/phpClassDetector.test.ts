import * as assert from 'assert';
import { PhpClassDetector, sanitizePhpCode } from '../../core/PhpClassDetector';

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
        assert.ok(names.includes('JsonSerializable'));
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

        for (const name of ['HasFactory', 'SoftDeletes', 'Client', 'Cache', 'RuntimeException', 'DomainException']) {
            assert.ok(result.includes(name), `${name} missing`);
        }
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
});
