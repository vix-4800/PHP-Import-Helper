import * as assert from 'assert';
import { generateUniqueImportAlias } from '../../core/ImportAliasGenerator';

suite('ImportAliasGenerator', () => {
    test('builds aliases from namespace segments from right to left', () => {
        assert.strictEqual(
            generateUniqueImportAlias(
                'Framework\\Database\\Exception',
                new Set(['Exception']),
                ['Base', 'Core']
            ),
            'DatabaseException'
        );
        assert.strictEqual(
            generateUniqueImportAlias(
                'Framework\\Database\\Exception',
                new Set(['Exception', 'databaseexception']),
                ['Base', 'Core']
            ),
            'FrameworkDatabaseException'
        );
    });

    test('falls back to configured prefixes and numeric suffixes', () => {
        assert.strictEqual(
            generateUniqueImportAlias(
                'JsonException',
                new Set(['JsonException']),
                ['Base', 'Core']
            ),
            'BaseJsonException'
        );
        assert.strictEqual(
            generateUniqueImportAlias(
                'JsonException',
                new Set([
                    'JsonException',
                    'BaseJsonException',
                    'CoreJsonException',
                    'JsonException2',
                ]),
                ['Base', 'Core']
            ),
            'JsonException3'
        );
    });

    test('normalizes namespace segments and ignores invalid prefixes', () => {
        assert.strictEqual(
            generateUniqueImportAlias(
                'vendor\\http_client\\Response',
                new Set(['Response']),
                ['', '123', 'Base Name', 'Core']
            ),
            'HttpClientResponse'
        );
        assert.strictEqual(
            generateUniqueImportAlias(
                'Response',
                new Set(['Response']),
                ['', '123', 'Base Name', 'Core']
            ),
            'CoreResponse'
        );
    });
});
