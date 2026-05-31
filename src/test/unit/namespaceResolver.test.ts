import * as assert from 'assert';
import { NamespaceResolver } from '../../core/NamespaceResolver';

suite('NamespaceResolver', () => {
    test('caches negative fallback lookups until cleared', async () => {
        let findCalls = 0;
        const resolver = new NamespaceResolver(
            { resolve: () => [] },
            {
                findClassFiles: async () => {
                    findCalls++;
                    return [];
                },
                readFile: async () => '',
            }
        );

        assert.deepStrictEqual(await resolver.resolve('MissingThing'), []);
        assert.deepStrictEqual(await resolver.resolve('MissingThing'), []);
        assert.strictEqual(findCalls, 1);

        resolver.clearNegativeLookups();

        assert.deepStrictEqual(await resolver.resolve('MissingThing'), []);
        assert.strictEqual(findCalls, 2);
    });

    test('uses workspace file search on cache miss', async () => {
        const resolver = new NamespaceResolver(
            { resolve: () => [] },
            {
                findClassFiles: async () => [{ fsPath: '/workspace/app/Http/Request.php' }],
                readFile: async () => `<?php

namespace App\\Http;

class Request {}
`,
            }
        );

        assert.deepStrictEqual(await resolver.resolve('Request'), [
            {
                fqcn: 'App\\Http\\Request',
                source: 'project',
                uri: { fsPath: '/workspace/app/Http/Request.php' },
            },
        ]);
    });

    test('passes active URI to fallback workspace search', async () => {
        const activeUri = { fsPath: '/workspace/packages/blog/src/Post.php' };
        const seenActiveUris: Array<{ fsPath: string } | undefined> = [];
        const resolver = new NamespaceResolver(
            { resolve: () => [] },
            {
                findClassFiles: async (_className, active) => {
                    seenActiveUris.push(active);
                    return [];
                },
                readFile: async () => '',
            }
        );

        await resolver.resolve('MissingPost', activeUri);

        assert.deepStrictEqual(seenActiveUris, [activeUri]);
    });

    test('clearNegativeLookups allows a later fallback hit for the same class', async () => {
        let files: Array<{ fsPath: string }> = [];
        const resolver = new NamespaceResolver(
            { resolve: () => [] },
            {
                findClassFiles: async () => files,
                readFile: async () => `<?php

namespace App\\Models;

class User {}
`,
            }
        );

        assert.deepStrictEqual(await resolver.resolve('User'), []);

        files = [{ fsPath: '/workspace/app/Models/User.php' }];
        resolver.clearNegativeLookups();

        assert.deepStrictEqual(await resolver.resolve('User'), [
            {
                fqcn: 'App\\Models\\User',
                source: 'project',
                uri: { fsPath: '/workspace/app/Models/User.php' },
            },
        ]);
    });

    test('returns global class candidate from matching file without namespace', async () => {
        const resolver = new NamespaceResolver(
            { resolve: () => [] },
            {
                findClassFiles: async () => [{ fsPath: '/workspace/vendor/mockery/Mockery.php' }],
                readFile: async () => `<?php

class Mockery {}
`,
            }
        );

        assert.deepStrictEqual(await resolver.resolve('Mockery'), [
            {
                fqcn: 'Mockery',
                source: 'global',
                uri: { fsPath: '/workspace/vendor/mockery/Mockery.php' },
            },
        ]);
    });

    test('prefers built-in global classes over cached namespace matches', async () => {
        const resolver = new NamespaceResolver(
            {
                resolve: () => [{
                    fqcn: 'RectorPrefix202605\\Nette\\Utils\\JsonException',
                    source: 'vendor',
                    uri: { fsPath: '/workspace/tools/rector/vendor/nette/utils/src/Utils/exceptions.php' } as never,
                }],
            },
            {
                findClassFiles: async () => [],
                readFile: async () => '',
            }
        );

        assert.deepStrictEqual(await resolver.resolve('JsonException'), [
            {
                fqcn: 'JsonException',
                source: 'global',
                uri: { fsPath: '' },
            },
        ]);
    });
});
