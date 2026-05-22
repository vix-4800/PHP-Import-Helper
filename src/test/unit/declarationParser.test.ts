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

    test('returns alias for imported fully qualified class', () => {
        const result = parser.getImportedClassName(`<?php

use yii\\httpclient\\Client as cl;

class Foo {}
`, 'yii\\httpclient\\Client');

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
});
