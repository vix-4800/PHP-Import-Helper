import * as assert from 'assert';
import * as vscode from 'vscode';
import { NamespaceCache } from '../../core/NamespaceCache';
import { openWorkspaceFile, testWorkspaceRoot, wait } from './helper';

function storageUri(name: string): vscode.Uri {
    return vscode.Uri.joinPath(vscode.Uri.file(process.cwd()), '.vscode-test', 'cache-tests', name);
}

suite('NamespaceCache', () => {
    test('persists rebuilt fixture index and loads it on initialize', async () => {
        const storage = storageUri(`persist-${Date.now()}`);
        const first = new NamespaceCache(storage);

        await first.rebuild([
            {
                className: 'User',
                fqcn: 'App\\Models\\User',
                uri: vscode.Uri.file('/project/app/Models/User.php'),
            },
        ]);
        first.dispose();

        const second = new NamespaceCache(storage);
        await second.initialize();

        assert.deepStrictEqual(second.resolve('User').map((item) => item.fqcn), [
            'App\\Models\\User',
        ]);

        second.dispose();
    });

    test('ignores persisted index with unsupported version', async () => {
        const storage = storageUri(`version-${Date.now()}`);
        const indexUri = vscode.Uri.joinPath(storage, 'namespace-index.json');

        await vscode.workspace.fs.createDirectory(storage);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: -1,
            files: {
                'file:///project/app/Models/User.php': {
                    entries: [{ className: 'User', fqcn: 'App\\Models\\User' }],
                },
            },
        }), 'utf8'));

        const cache = new NamespaceCache(storage);
        await cache.initialize();

        assert.deepStrictEqual(cache.resolve('User'), []);

        cache.dispose();
    });

    test('updates stale persisted entries on initialize', async () => {
        const storage = storageUri(`stale-${Date.now()}`);
        const indexUri = vscode.Uri.joinPath(storage, 'namespace-index.json');
        const editor = await openWorkspaceFile('cache-stale/NewUser.php', `<?php

namespace App\\Models;

class NewUser {}
`);
        const fileUri = editor.document.uri;

        await vscode.workspace.fs.createDirectory(storage);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: 1,
            files: {
                [fileUri.toString()]: {
                    mtime: 0,
                    entries: [{ className: 'OldUser', fqcn: 'App\\Models\\OldUser' }],
                },
            },
        }), 'utf8'));

        const cache = new NamespaceCache(storage);
        await cache.initialize();
        await wait(300);

        assert.deepStrictEqual(cache.resolve('OldUser'), []);
        assert.deepStrictEqual(cache.resolve('NewUser').map((item) => item.fqcn), [
            'App\\Models\\NewUser',
        ]);
        assert.ok(vscode.workspace.getWorkspaceFolder(testWorkspaceRoot()) !== undefined);

        cache.dispose();
    });
});
