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

    test('caches successful fallback lookups until cleared', async () => {
        let findCalls = 0;
        const resolver = new NamespaceResolver(
            { resolve: () => [] },
            {
                findClassFiles: async () => {
                    findCalls++;
                    return [{ fsPath: '/workspace/vendor/framework/Controller.php' }];
                },
                readFile: async () => `<?php

namespace Framework\\Web;

class Controller {}
`,
            }
        );

        assert.deepStrictEqual(
            (await resolver.resolve('Controller')).map((item) => item.fqcn),
            ['Framework\\Web\\Controller']
        );
        assert.deepStrictEqual(
            (await resolver.resolve('Controller')).map((item) => item.fqcn),
            ['Framework\\Web\\Controller']
        );
        assert.strictEqual(findCalls, 1);

        resolver.clearLookups();

        assert.deepStrictEqual(
            (await resolver.resolve('Controller')).map((item) => item.fqcn),
            ['Framework\\Web\\Controller']
        );
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
