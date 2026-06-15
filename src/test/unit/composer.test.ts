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

    test('parses array paths and strips trailing slashes', () => {
        const autoload = parseAutoload({
            autoload: {
                'psr-4': {
                    'App\\': ['app/', 'src/App//'],
                },
            },
        });

        assert.deepStrictEqual(autoload.psr4, [
            { namespace: 'App', paths: ['app', 'src/App'] },
        ]);
    });

    test('prefers psr-4 over psr-0 when both match', () => {
        const autoload = parseAutoload({
            autoload: {
                'psr-4': { 'App\\': 'app/' },
                'psr-0': { 'Legacy\\': 'app/' },
            },
        });

        assert.strictEqual(resolveNamespace('/project/app/Models', autoload), 'App\\Models');
    });

    test('resolves conventional app directory', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'app/' } },
        });

        assert.strictEqual(resolveNamespace('/project/app', autoload), 'App');
    });

    test('resolves namespace from Windows absolute composer path', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'Package\\': 'C:\\workspace\\packages\\blog\\src\\' } },
        });

        assert.strictEqual(
            resolveNamespace('C:\\workspace\\packages\\blog\\src\\Http', autoload),
            'Package\\Http',
        );
    });

    test('returns null for unmatched paths', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'app/' } },
        });

        assert.strictEqual(resolveNamespace('/project/database/migrations', autoload), null);
    });
});
