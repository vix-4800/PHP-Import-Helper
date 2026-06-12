import * as assert from 'assert';
import * as vscode from 'vscode';
import { NamespaceCache } from '../../core/NamespaceCache';
import { openWorkspaceFile, wait } from './helper';

type CacheActivityEvent = {
    kind: 'start' | 'end';
    phase: 'initialize' | 'rebuild' | 'update';
};

type CacheInternals = {
    persistIndex: () => Promise<void>;
    scheduleIndexFile: (uri: vscode.Uri) => void;
};

type CacheConstructorInternals = {
    persistDebounceMs: number;
};

function storageUri(name: string): vscode.Uri {
    return vscode.Uri.joinPath(
        vscode.Uri.file(process.cwd()),
        '.vscode-test',
        'cache-tests',
        process.env.VSCODE_TEST_RUN_ID ?? 'default',
        name
    );
}

async function waitForActivityEnd(cache: NamespaceCache, phase: CacheActivityEvent['phase']): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
        let subscription: vscode.Disposable;
        const timeout = setTimeout(() => {
            subscription.dispose();
            reject(new Error(`Timed out waiting for ${phase} activity end.`));
        }, 5000);
        subscription = cache.onDidChangeActivity((event) => {
            if (event.kind !== 'end' || event.phase !== phase) {
                return;
            }

            clearTimeout(timeout);
            subscription.dispose();
            resolve();
        });
    });
}

async function waitForResolvedState(
    predicate: () => boolean
): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 5000) {
        if (predicate()) {
            return;
        }

        await wait(50);
    }
}

suite('NamespaceCache', () => {
    test('emits initialize activity while loading cache', async () => {
        const storage = storageUri(`initialize-${Date.now()}`);
        const cache = new NamespaceCache(storage);
        const events: CacheActivityEvent[] = [];

        cache.onDidChangeActivity((event) => events.push(event));

        await cache.initialize();

        assert.deepStrictEqual(events, [
            { kind: 'start', phase: 'initialize' },
            { kind: 'end', phase: 'initialize' },
        ]);

        cache.dispose();
    });

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

    test('emits rebuild activity while rebuilding fixture index', async () => {
        const storage = storageUri(`rebuild-${Date.now()}`);
        const cache = new NamespaceCache(storage);
        const events: CacheActivityEvent[] = [];

        cache.onDidChangeActivity((event) => events.push(event));

        await cache.rebuild([
            {
                className: `RebuiltUser${Date.now()}`,
                fqcn: 'App\\Models\\RebuiltUser',
                uri: vscode.Uri.file('/project/app/Models/RebuiltUser.php'),
            },
        ]);

        assert.deepStrictEqual(events, [
            { kind: 'start', phase: 'rebuild' },
            { kind: 'end', phase: 'rebuild' },
        ]);

        cache.dispose();
    });

    test('ignores persisted index from the single-namespace format', async () => {
        const storage = storageUri(`version-${Date.now()}`);
        const indexUri = vscode.Uri.joinPath(storage, 'namespace-index.json');
        const className = `UnsupportedUser${Date.now()}`;

        await vscode.workspace.fs.createDirectory(storage);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: 1,
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
            version: 2,
            files: {
                [fileUri.toString()]: {
                    mtime: -1,
                    entries: [{ className: oldClassName, fqcn: `App\\Models\\${oldClassName}` }],
                },
            },
        }), 'utf8'));

        const cache = new NamespaceCache(storage);
        await cache.initialize();

        await waitForResolvedState(() =>
            cache.resolve(oldClassName).length === 0 &&
            cache.resolve(className).length > 0
        );

        assert.deepStrictEqual(cache.resolve(oldClassName), []);
        assert.deepStrictEqual(cache.resolve(className).map((item) => item.fqcn), [
            `App\\Models\\${className}`,
        ]);

        cache.dispose();
    });

    test('does not persist loaded index when PHP mtimes are unchanged', async () => {
        const storage = storageUri(`fresh-${Date.now()}`);
        const indexUri = vscode.Uri.joinPath(storage, 'namespace-index.json');
        const className = `FreshUser${Date.now()}`;
        const editor = await openWorkspaceFile(`cache-fresh/${className}.php`, `<?php

namespace App\\Models;

class ${className} {}
`);
        const fileUri = editor.document.uri;
        const stat = await vscode.workspace.fs.stat(fileUri);
        const cache = new NamespaceCache(storage);
        let persists = 0;

        await vscode.workspace.fs.createDirectory(storage);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: 2,
            files: {
                [fileUri.toString()]: {
                    mtime: stat.mtime,
                    entries: [{ className, fqcn: `App\\Models\\${className}` }],
                },
            },
        }), 'utf8'));

        (cache as unknown as CacheInternals).persistIndex = async () => {
            persists++;
        };

        await cache.initialize();

        assert.strictEqual(persists, 0);
        assert.deepStrictEqual(cache.resolve(className).map((item) => item.fqcn), [
            `App\\Models\\${className}`,
        ]);

        cache.dispose();
    });

    test('emits update activity for watched file changes', async () => {
        const storage = storageUri(`watch-${Date.now()}`);
        const className = `WatchedUser${Date.now()}`;
        const cache = new NamespaceCache(storage);
        const events: CacheActivityEvent[] = [];

        cache.onDidChangeActivity((event) => events.push(event));

        await cache.initialize();
        events.length = 0;

        const editor = await openWorkspaceFile(`cache-watch/${className}.php`, `<?php

namespace App\\Models;

        class ${className} {}
`);
        const updateEnded = waitForActivityEnd(cache, 'update');
        (cache as unknown as CacheInternals).scheduleIndexFile(editor.document.uri);
        await updateEnded;

        assert.deepStrictEqual(events, [
            { kind: 'start', phase: 'update' },
            { kind: 'end', phase: 'update' },
        ]);
        assert.deepStrictEqual(cache.resolve(className).map((item) => item.fqcn), [
            `App\\Models\\${className}`,
        ]);

        cache.dispose();
    });

    test('batches watched PHP file changes into one update and persist', async () => {
        const storage = storageUri(`batch-${Date.now()}`);
        const firstClassName = `FirstWatchedUser${Date.now()}`;
        const secondClassName = `SecondWatchedUser${Date.now()}`;
        const first = await openWorkspaceFile(`cache-batch/${firstClassName}.php`, `<?php

namespace App\\Models;

class ${firstClassName} {}
`);
        const second = await openWorkspaceFile(`cache-batch/${secondClassName}.php`, `<?php

namespace App\\Models;

class ${secondClassName} {}
`);
        const cache = new NamespaceCache(storage);
        const cacheConstructor = NamespaceCache as unknown as CacheConstructorInternals;
        const previousPersistDebounceMs = cacheConstructor.persistDebounceMs;
        const internals = cache as unknown as CacheInternals;
        const events: CacheActivityEvent[] = [];
        let updates = 0;
        let persists = 0;

        try {
            cacheConstructor.persistDebounceMs = 10;
            internals.persistIndex = async () => {
                persists++;
            };
            cache.onDidChangeActivity((event) => events.push(event));
            cache.onDidUpdate(() => updates++);

            const updateEnded = waitForActivityEnd(cache, 'update');
            internals.scheduleIndexFile(first.document.uri);
            internals.scheduleIndexFile(second.document.uri);
            await updateEnded;
            await wait(50);

            assert.deepStrictEqual(events, [
                { kind: 'start', phase: 'update' },
                { kind: 'end', phase: 'update' },
            ]);
            assert.strictEqual(updates, 1);
            assert.strictEqual(persists, 1);
            assert.deepStrictEqual(cache.resolve(firstClassName).map((item) => item.fqcn), [
                `App\\Models\\${firstClassName}`,
            ]);
            assert.deepStrictEqual(cache.resolve(secondClassName).map((item) => item.fqcn), [
                `App\\Models\\${secondClassName}`,
            ]);
        } finally {
            cacheConstructor.persistDebounceMs = previousPersistDebounceMs;
            cache.dispose();
        }
    });

    test('skips watched PHP files excluded by index settings', async () => {
        const storage = storageUri(`excluded-watch-${Date.now()}`);
        const className = `ExcludedWatchedUser${Date.now()}`;
        const editor = await openWorkspaceFile(`vendor/${className}.php`, `<?php

namespace Vendor\\Pkg;

class ${className} {}
`);
        const cache = new NamespaceCache(storage);
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previous = config.get<string[]>('index.exclude');
        const events: CacheActivityEvent[] = [];
        let updates = 0;

        try {
            await config.update('index.exclude', ['**/vendor/**'], vscode.ConfigurationTarget.Global);
            cache.onDidChangeActivity((event) => events.push(event));
            cache.onDidUpdate(() => updates++);

            (cache as unknown as CacheInternals).scheduleIndexFile(editor.document.uri);
            await wait(1500);

            assert.deepStrictEqual(events, []);
            assert.strictEqual(updates, 0);
            assert.deepStrictEqual(cache.resolve(className), []);
        } finally {
            await config.update('index.exclude', previous, vscode.ConfigurationTarget.Global);
            cache.dispose();
        }
    });

    test('skips excluded PHP files during rebuild scan', async () => {
        const storage = storageUri(`excluded-rebuild-${Date.now()}`);
        const className = `ExcludedRebuildUser${Date.now()}`;
        const editor = await openWorkspaceFile(`vendor/${className}.php`, `<?php

namespace Vendor\\Pkg;

class ${className} {}
`);
        const cache = new NamespaceCache(storage);
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previous = config.get<string[]>('index.exclude');

        try {
            await config.update('index.exclude', ['**/vendor/**'], vscode.ConfigurationTarget.Global);
            await cache.rebuild();

            assert.ok(editor.document.uri.fsPath.includes('/vendor/') || editor.document.uri.fsPath.includes('\\vendor\\'));
            assert.deepStrictEqual(cache.resolve(className), []);
        } finally {
            await config.update('index.exclude', previous, vscode.ConfigurationTarget.Global);
            cache.dispose();
        }
    });

    test('ignores non-PHP files scheduled defensively', async () => {
        const storage = storageUri(`non-php-${Date.now()}`);
        const uri = vscode.Uri.joinPath(storage, 'README.md');
        const cache = new NamespaceCache(storage);
        const events: CacheActivityEvent[] = [];
        let updates = 0;

        cache.onDidChangeActivity((event) => events.push(event));
        cache.onDidUpdate(() => updates++);

        (cache as unknown as CacheInternals).scheduleIndexFile(uri);
        await wait(1500);

        assert.deepStrictEqual(events, []);
        assert.strictEqual(updates, 0);

        cache.dispose();
    });
});
