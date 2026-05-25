import * as assert from 'assert';
import * as path from 'path';
import {
    applyGeneratedNamespace,
    findNearestComposerPath,
    generateNamespace,
} from '../../core/NamespaceGenerator';
import { parseAutoload } from '../../core/composer';

function absolutePath(...segments: string[]): string {
    return path.join(path.parse(process.cwd()).root, ...segments);
}

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

    test('resolves relative composer paths from composer directory', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'Package\\': 'src/' } },
        });
        const composerDirectory = absolutePath('workspace', 'packages', 'blog');
        const filePath = path.join(composerDirectory, 'src', 'Http', 'Controller.php');

        assert.strictEqual(
            generateNamespace(filePath, autoload, composerDirectory),
            'Package\\Http',
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
        const workspaceRoot = absolutePath('project');
        const composerPath = path.join(workspaceRoot, 'packages', 'blog', 'composer.json');
        const result = await findNearestComposerPath(
            path.join(workspaceRoot, 'packages', 'blog', 'src', 'Controller', 'PostController.php'),
            workspaceRoot,
            async (candidate) => {
                checked.push(candidate);

                return candidate === composerPath;
            }
        );

        assert.strictEqual(result, composerPath);
        assert.deepStrictEqual(checked, [
            path.join(workspaceRoot, 'packages', 'blog', 'src', 'Controller', 'composer.json'),
            path.join(workspaceRoot, 'packages', 'blog', 'src', 'composer.json'),
            composerPath,
        ]);
    });

    test('does not search above workspace root for composer json', async () => {
        const checked: string[] = [];
        const workspaceRoot = absolutePath('project', 'packages');
        const result = await findNearestComposerPath(
            path.join(workspaceRoot, 'blog', 'src', 'Post.php'),
            workspaceRoot,
            async (candidate) => {
                checked.push(candidate);

                return false;
            }
        );

        assert.strictEqual(result, null);
        assert.ok(!checked.includes(absolutePath('project', 'composer.json')));
    });
});
