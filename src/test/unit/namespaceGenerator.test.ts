import * as assert from 'assert';
import {
    applyGeneratedNamespace,
    findNearestComposerPath,
    generateNamespace,
} from '../../core/NamespaceGenerator';
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

    test('finds nearest composer json walking upward to workspace root', async () => {
        const checked: string[] = [];
        const result = await findNearestComposerPath(
            '/project/packages/blog/src/Controller/PostController.php',
            '/project',
            async (candidate) => {
                checked.push(candidate);

                return candidate === '/project/packages/blog/composer.json';
            }
        );

        assert.strictEqual(result, '/project/packages/blog/composer.json');
        assert.deepStrictEqual(checked, [
            '/project/packages/blog/src/Controller/composer.json',
            '/project/packages/blog/src/composer.json',
            '/project/packages/blog/composer.json',
        ]);
    });

    test('does not search above workspace root for composer json', async () => {
        const checked: string[] = [];
        const result = await findNearestComposerPath(
            '/project/packages/blog/src/Post.php',
            '/project/packages',
            async (candidate) => {
                checked.push(candidate);

                return false;
            }
        );

        assert.strictEqual(result, null);
        assert.ok(!checked.includes('/project/composer.json'));
    });
});
