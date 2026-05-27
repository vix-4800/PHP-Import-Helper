import * as assert from 'assert';
import {
    buildIndexExcludeGlob,
    defaultIndexExcludePatterns,
    shouldIncludePhpFile,
} from '../../utils/indexExcludes';

suite('index excludes', () => {
    test('includes PHP files outside excluded directories', () => {
        assert.strictEqual(
            shouldIncludePhpFile(
                '/workspace/app/Models/User.php',
                ['/workspace'],
                defaultIndexExcludePatterns
            ),
            true
        );
    });

    test('excludes PHP files under configured excluded directories', () => {
        assert.strictEqual(
            shouldIncludePhpFile(
                '/workspace/vendor/acme/Package/User.php',
                ['/workspace'],
                defaultIndexExcludePatterns
            ),
            false
        );
        assert.strictEqual(
            shouldIncludePhpFile(
                '/workspace/.vscode-test/fixtures/default/vendor/User.php',
                ['/workspace'],
                defaultIndexExcludePatterns
            ),
            false
        );
        assert.strictEqual(
            shouldIncludePhpFile(
                '/workspace/storage/framework/cache/data.php',
                ['/workspace'],
                defaultIndexExcludePatterns
            ),
            false
        );
    });

    test('rejects non-PHP files and files outside known roots', () => {
        assert.strictEqual(
            shouldIncludePhpFile(
                '/workspace/README.md',
                ['/workspace'],
                defaultIndexExcludePatterns
            ),
            false
        );
        assert.strictEqual(
            shouldIncludePhpFile(
                '/other/app/Models/User.php',
                ['/workspace'],
                defaultIndexExcludePatterns
            ),
            false
        );
    });

    test('builds combined glob for findFiles excludes', () => {
        assert.strictEqual(buildIndexExcludeGlob([]), undefined);
        assert.strictEqual(buildIndexExcludeGlob(['**/vendor/**']), '**/vendor/**');
        assert.strictEqual(
            buildIndexExcludeGlob(['**/vendor/**', '**/runtime/**']),
            '{**/vendor/**,**/runtime/**}'
        );
    });
});
