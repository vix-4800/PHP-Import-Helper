import * as assert from 'assert';
import { DeclarationParser } from '../../core/DeclarationParser';

suite('DeclarationParser', () => {
    const parser = new DeclarationParser();

    test('parses namespace, declare, imports, and class declaration lines', () => {
        const result = parser.parse(`<?php
declare(strict_types=1);

namespace App\\Http;

use App\\Models\\User;
use function App\\Support\\helper;
use const App\\Config\\VERSION;

final class Controller {}
`);

        assert.strictEqual(result.namespace, 'App\\Http');
        assert.strictEqual(result.declarationLines.phpTag, 1);
        assert.strictEqual(result.declarationLines.declare, 2);
        assert.strictEqual(result.declarationLines.namespace, 4);
        assert.strictEqual(result.declarationLines.firstUseStatement, 6);
        assert.strictEqual(result.declarationLines.lastUseStatement, 8);
        assert.strictEqual(result.declarationLines.classDeclaration, 10);
        assert.deepStrictEqual(result.useStatements.map((statement) => [statement.className, statement.kind]), [
            ['User', 'class'],
            ['helper', 'function'],
            ['VERSION', 'const'],
        ]);
    });

    test('parses php tag line with leading whitespace', () => {
        const result = parser.parse(`

<?php

namespace App;
`);

        assert.strictEqual(result.declarationLines.phpTag, 3);
        assert.strictEqual(result.declarationLines.namespace, 5);
    });

    test('parses inline php namespace syntax with leading whitespace', () => {
        const result = parser.parse(`
  <?php namespace App\\Inline;

use App\\Models\\User;

class Foo {}
`);

        assert.strictEqual(result.namespace, 'App\\Inline');
        assert.strictEqual(result.declarationLines.phpTag, 2);
        assert.strictEqual(result.declarationLines.namespace, 2);
        assert.deepStrictEqual(result.useStatements.map((statement) => statement.className), ['User']);
    });

    test('parses grouped imports with aliases and nested names', () => {
        const result = parser.parse(`<?php

use App\\{Models\\User as AppUser, Http\\Request};

class Foo {}
`);

        assert.deepStrictEqual(result.useStatements.map((statement) => ({
            fqcn: statement.fqcn,
            className: statement.className,
            alias: statement.alias,
        })), [
            { fqcn: 'App\\Models\\User', className: 'AppUser', alias: 'AppUser' },
            { fqcn: 'App\\Http\\Request', className: 'Request', alias: null },
        ]);
    });

    test('parses multiline grouped imports and ignores trait use inside class body', () => {
        const result = parser.parse(`<?php

use App\\Models\\{
    User,
    Post,
};

class Foo {
    use HasFactory;
}
`);

        assert.deepStrictEqual(result.useStatements.map((statement) => statement.className), ['User', 'Post']);
        assert.strictEqual(result.declarationLines.lastUseStatement, 6);
    });

    test('parses bracketed namespaces and preserves top-level imports only', () => {
        const result = parser.parse(`<?php

namespace App\\Http {
    use App\\Models\\User;

    class Foo {
        use HasFactory;
    }
}
`);

        assert.strictEqual(result.namespace, 'App\\Http');
        assert.deepStrictEqual(result.useStatements.map((statement) => statement.className), ['User']);
        assert.strictEqual(result.declarationLines.firstUseStatement, 4);
        assert.strictEqual(result.declarationLines.classDeclaration, 6);
    });

    test('returns alias for imported fully qualified class', () => {
        const result = parser.getImportedClassName(`<?php

use Framework\\Http\\Client as cl;

class Foo {}
`, 'Framework\\Http\\Client');

        assert.strictEqual(result, 'cl');
    });

    test('class import names skip function and const imports', () => {
        const result = parser.getImportedClassNames(`<?php

use App\\Models\\User;
use function App\\Helpers\\helper;
use const App\\Config\\VERSION;

class Foo {}
`);

        assert.deepStrictEqual(result, ['User']);
    });

    test('detects readonly and final readonly declared class names', () => {
        assert.deepStrictEqual(parser.getDeclaredClassNames(`<?php

readonly class ValueObject {}
`), ['ValueObject']);

        assert.deepStrictEqual(parser.getDeclaredClassNames(`<?php

final readonly class UserDTO {}
`), ['UserDTO']);
    });

    test('throws when class in grouped import is already imported', () => {
        assert.throws(() => parser.parse(`<?php

use App\\Models\\{User, Post};

class Foo {}
`, 'App\\Models\\User'), /already imported/);
    });

    test('ignores namespace imports that appear after first class declaration', () => {
        const result = parser.parse(`<?php

use App\\Models\\User;

class Foo {}

use App\\Models\\Post;
`);

        assert.deepStrictEqual(result.useStatements.map((statement) => statement.className), ['User']);
    });

    test('falls back to declaration scanning when parser reports syntax errors', () => {
        const result = parser.parse(`<?php

namespace App\\Broken;

use App\\Models\\User;
use App\\Models\\Post as BlogPost;

class Foo {
    public private(set) PropertyValue $value {
        set(HookValue $value) => $this->value = $value;
    }
}
`);

        assert.strictEqual(result.namespace, 'App\\Broken');
        assert.deepStrictEqual(result.useStatements.map((statement) => ({
            fqcn: statement.fqcn,
            className: statement.className,
            alias: statement.alias,
        })), [
            { fqcn: 'App\\Models\\User', className: 'User', alias: null },
            { fqcn: 'App\\Models\\Post', className: 'BlogPost', alias: 'BlogPost' },
        ]);
        assert.deepStrictEqual(result.declaredClassNames, ['Foo']);
    });
});
