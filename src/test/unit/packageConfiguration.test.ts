import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface ConfigurationProperty {
    default?: unknown;
    tags?: string[];
}

suite('package configuration', () => {
    test('marks automatic conflict alias settings as experimental metadata', () => {
        const packageJson = JSON.parse(
            fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
        ) as {
            contributes: {
                configuration: {
                    properties: Record<string, ConfigurationProperty>;
                };
            };
        };
        const properties = packageJson.contributes.configuration.properties;

        assert.deepStrictEqual(
            properties['phpImportHelper.autoAliasConflicts']?.tags,
            ['experimental']
        );
        assert.strictEqual(
            properties['phpImportHelper.autoAliasConflicts']?.default,
            false
        );
        assert.deepStrictEqual(
            properties['phpImportHelper.autoAliasPrefixes']?.tags,
            ['experimental']
        );
        assert.deepStrictEqual(
            properties['phpImportHelper.autoAliasPrefixes']?.default,
            ['Base', 'Core']
        );
        assert.strictEqual(
            properties['phpImportHelper.experimental.autoAliasConflicts'],
            undefined
        );
    });
});
