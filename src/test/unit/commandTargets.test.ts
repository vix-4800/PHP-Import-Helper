import * as assert from 'assert';
import { parseClassTarget } from '../../features/commandTargets';

suite('command class targets', () => {
    test('parses selected fully qualified class as direct import target', () => {
        assert.deepStrictEqual(parseClassTarget('\\App\\Http\\Request'), {
            rawName: '\\App\\Http\\Request',
            className: 'Request',
            fqcn: 'App\\Http\\Request',
        });
    });

    test('parses short class as cache lookup target', () => {
        assert.deepStrictEqual(parseClassTarget('Request'), {
            rawName: 'Request',
            className: 'Request',
            fqcn: null,
        });
    });
});
