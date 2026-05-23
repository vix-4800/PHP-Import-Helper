import * as assert from 'assert';
import { applyGeneratedNamespace, generateNamespace } from '../../core/NamespaceGenerator';
import { parseAutoload } from '../../core/composer';

suite('generateNamespace', () => {
    test('generates namespace from psr-4 composer mapping', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'app/' } },
        });

        assert.strictEqual(
            generateNamespace('/project/app/Http/Controllers/UserController.php', autoload),
            'App\\Http\\Controllers',
        );
    });

    test('returns null when path is not covered by composer autoload', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'app/' } },
        });

        assert.strictEqual(generateNamespace('/project/database/migrations/CreateUsers.php', autoload), null);
    });

    test('inserts namespace after declare statement', () => {
        assert.strictEqual(applyGeneratedNamespace(`<?php
declare(strict_types=1);

class Foo {}
`, 'App\\Models'), `<?php
declare(strict_types=1);

namespace App\\Models;

class Foo {}
`);
    });

    test('replaces existing namespace statement', () => {
        assert.strictEqual(applyGeneratedNamespace(`<?php

namespace Old\\Name;

class Foo {}
`, 'App\\Models'), `<?php

namespace App\\Models;

class Foo {}
`);
    });
});
