import * as assert from 'assert';
import { ComposerVendorMapParser } from '../../core/ComposerVendorMapParser';

suite('ComposerVendorMapParser', () => {
    const parser = new ComposerVendorMapParser();

    test('parses autoload_classmap.php entries', () => {
        const entries = parser.parse('/workspace/vendor/composer/autoload_classmap.php', `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
    'Vendor\\Package\\User' => $vendorDir . '/vendor/package/src/User.php',
    'App\\Database\\Seeder' => $baseDir . '/database/seeders/Seeder.php',
);
`);

        assert.deepStrictEqual(entries.map((entry) => ({
            className: entry.className,
            fqcn: entry.fqcn,
            fsPath: entry.uri.fsPath,
        })), [
            {
                className: 'User',
                fqcn: 'Vendor\\Package\\User',
                fsPath: '/workspace/vendor/vendor/package/src/User.php',
            },
            {
                className: 'Seeder',
                fqcn: 'App\\Database\\Seeder',
                fsPath: '/workspace/database/seeders/Seeder.php',
            },
        ]);
    });

    test('parses autoload_static.php classMap entries', () => {
        const entries = parser.parse('/workspace/vendor/composer/autoload_static.php', `<?php

class ComposerStaticInit
{
    public static $classMap = array (
        'Illuminate\\Support\\Collection' => __DIR__ . '/..' . '/laravel/framework/src/Illuminate/Support/Collection.php',
    );
}
`);

        assert.deepStrictEqual(entries.map((entry) => ({
            className: entry.className,
            fqcn: entry.fqcn,
            fsPath: entry.uri.fsPath,
        })), [
            {
                className: 'Collection',
                fqcn: 'Illuminate\\Support\\Collection',
                fsPath: '/workspace/vendor/laravel/framework/src/Illuminate/Support/Collection.php',
            },
        ]);
    });

    test('returns no entries for malformed map text', () => {
        assert.deepStrictEqual(
            parser.parse('/workspace/vendor/composer/autoload_classmap.php', '<?php return broken;'),
            []
        );
    });

    test('derives global class short name from FQCN', () => {
        const entries = parser.parse('/workspace/vendor/composer/autoload_classmap.php', `<?php
return array(
    'Mockery' => __DIR__ . '/../mockery/mockery/library/Mockery.php',
);
`);

        assert.deepStrictEqual(entries.map((entry) => entry.className), ['Mockery']);
    });

    test('unescapes php single-quoted strings without double unescaping', () => {
        const entries = parser.parse('/workspace/vendor/composer/autoload_classmap.php', String.raw`<?php
return array(
    'Foo\\\\\'Bar' => __DIR__ . '/Test.php',
);
`);

        assert.strictEqual(entries[0]?.fqcn, String.raw`Foo\\'Bar`);
    });
});
