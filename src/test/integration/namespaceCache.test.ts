import * as assert from 'assert';
import * as vscode from 'vscode';
import { NamespaceCache } from '../../core/NamespaceCache';
import { openWorkspaceFile, testWorkspaceRoot, wait } from './helper';

function storageUri(name: string): vscode.Uri {
    return vscode.Uri.joinPath(
        vscode.Uri.file(process.cwd()),
        '.vscode-test',
        'cache-tests',
        process.env.VSCODE_TEST_RUN_ID ?? 'default',
        name
    );
}

suite('NamespaceCache', () => {
    test('persists rebuilt fixture index and loads it on initialize', async () => {
        const storage = storageUri(`persist-${Date.now()}`);
        const className = `PersistedUser${Date.now()}`;
        const first = new NamespaceCache(storage);

        await first.rebuild([
            {
                className,
                fqcn: `App\\Models\\${className}`,
                uri: vscode.Uri.file(`/project/app/Models/${className}.php`),
            },
        ]);
        first.dispose();

        const second = new NamespaceCache(storage);
        await second.initialize();

        assert.deepStrictEqual(second.resolve(className).map((item) => item.fqcn), [
            `App\\Models\\${className}`,
        ]);

        second.dispose();
    });

    test('ignores persisted index with unsupported version', async () => {
        const storage = storageUri(`version-${Date.now()}`);
        const indexUri = vscode.Uri.joinPath(storage, 'namespace-index.json');
        const className = `UnsupportedUser${Date.now()}`;

        await vscode.workspace.fs.createDirectory(storage);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: -1,
            files: {
                'file:///project/app/Models/User.php': {
                    entries: [{ className, fqcn: `App\\Models\\${className}` }],
                },
            },
        }), 'utf8'));

        const cache = new NamespaceCache(storage);
        await cache.initialize();

        assert.deepStrictEqual(cache.resolve(className), []);

        cache.dispose();
    });

    test('updates stale persisted entries on initialize', async () => {
        const storage = storageUri(`stale-${Date.now()}`);
        const indexUri = vscode.Uri.joinPath(storage, 'namespace-index.json');
        const className = `NewUser${Date.now()}`;
        const oldClassName = `OldUser${Date.now()}`;
        const editor = await openWorkspaceFile(`cache-stale/${className}.php`, `<?php

namespace App\\Models;

class ${className} {}
`);
        const fileUri = editor.document.uri;

        await vscode.workspace.fs.createDirectory(storage);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: 1,
            files: {
                [fileUri.toString()]: {
                    mtime: -1,
                    entries: [{ className: oldClassName, fqcn: `App\\Models\\${oldClassName}` }],
                },
            },
        }), 'utf8'));

        const cache = new NamespaceCache(storage);
        await cache.initialize();
        await wait(300);

        assert.deepStrictEqual(cache.resolve(oldClassName), []);
        assert.deepStrictEqual(cache.resolve(className).map((item) => item.fqcn), [
            `App\\Models\\${className}`,
        ]);
        assert.ok(vscode.workspace.getWorkspaceFolder(testWorkspaceRoot()) !== undefined);

        cache.dispose();
    });
});
