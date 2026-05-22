import * as assert from 'assert';
import { parseAutoload, resolveNamespace } from '../../core/composer';

suite('composer autoload', () => {
    test('parses psr-4 mappings and normalizes namespace and paths', () => {
        const result = parseAutoload({
            autoload: {
                'psr-4': {
                    'App\\': ['src/', 'lib/'],
                },
            },
        });

        assert.deepStrictEqual(result.psr4, [{ namespace: 'App', paths: ['src', 'lib'] }]);
    });

    test('autoload-dev overrides same namespace from autoload', () => {
        const result = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'src/' } },
            'autoload-dev': { 'psr-4': { 'App\\': 'app/' } },
        });

        assert.deepStrictEqual(result.psr4, [{ namespace: 'App', paths: ['app'] }]);
    });

    test('resolves psr-4 namespace from nested path', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'src/' } },
        });

        assert.strictEqual(resolveNamespace('/project/src/Http/Controllers', autoload), 'App\\Http\\Controllers');
    });

    test('resolves psr-0 namespace from base path', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-0': { 'Legacy\\': 'lib/' } },
        });

        assert.strictEqual(resolveNamespace('/project/lib/Legacy/Util', autoload), 'Legacy\\Util');
    });
});
