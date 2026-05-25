import * as assert from 'assert';
import { NamespaceResolver } from '../../core/NamespaceResolver';

suite('NamespaceResolver', () => {
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
});
