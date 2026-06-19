import * as assert from 'assert';
import Module = require('module');
import type { IndexWorkerClient } from '../../core/IndexWorkerClient';

type NamespaceCacheModule = typeof import('../../core/NamespaceCache');

class EventEmitterStub {
    public readonly event = (): { dispose(): void } => ({
        dispose: () => undefined,
    });

    public fire(): void {}
    public dispose(): void {}
}

function loadNamespaceCache(): NamespaceCacheModule {
    const moduleLoader = Module as typeof Module & {
        _load(request: string, parent: NodeJS.Module | null, isMain: boolean): unknown;
    };
    const originalLoad = moduleLoader._load;

    moduleLoader._load = function patchedLoad(
        request: string,
        parent: NodeJS.Module | null,
        isMain: boolean
    ) {
        if (request === 'vscode') {
            return {
                EventEmitter: EventEmitterStub,
                workspace: {},
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[require.resolve('../../core/NamespaceCache')];

        return require('../../core/NamespaceCache') as NamespaceCacheModule;
    } finally {
        moduleLoader._load = originalLoad;
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

suite('NamespaceCache persistence', () => {
    test('does not run persisted index writes concurrently', async () => {
        const { NamespaceCache } = loadNamespaceCache();
        const cacheConstructor = NamespaceCache as unknown as {
            persistDebounceMs: number;
        };
        const previousDebounceMs = cacheConstructor.persistDebounceMs;
        const cache = new NamespaceCache(
            { toString: () => 'storage' } as never,
            undefined,
            {} as IndexWorkerClient
        );
        const internals = cache as unknown as {
            persistIndex(): Promise<void>;
            schedulePersistIndex(): void;
        };
        let releaseFirstWrite: (() => void) | undefined;
        const firstWrite = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        let writes = 0;
        let activeWrites = 0;
        let maximumActiveWrites = 0;

        try {
            cacheConstructor.persistDebounceMs = 1;
            internals.persistIndex = async () => {
                writes++;
                activeWrites++;
                maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);

                if (writes === 1) {
                    await firstWrite;
                }

                activeWrites--;
            };

            internals.schedulePersistIndex();
            await wait(10);
            internals.schedulePersistIndex();
            await wait(10);
            releaseFirstWrite?.();
            await wait(10);

            assert.strictEqual(maximumActiveWrites, 1);
            assert.strictEqual(writes, 2);
        } finally {
            releaseFirstWrite?.();
            cacheConstructor.persistDebounceMs = previousDebounceMs;
            cache.dispose();
        }
    });
});
