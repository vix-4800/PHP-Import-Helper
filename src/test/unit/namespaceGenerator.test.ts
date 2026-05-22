import * as assert from 'assert';
import { generateNamespace } from '../../core/NamespaceGenerator';
import { parseAutoload } from '../../core/composer';

suite('generateNamespace', () => {
    test('generates namespace from psr-4 composer mapping', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'app/' } },
        });

        assert.strictEqual(
            generateNamespace('/project/app/Http/Controllers/UserController.php', autoload),
            'App\\Http\\Controllers',
        );
    });

    test('returns null when path is not covered by composer autoload', () => {
        const autoload = parseAutoload({
            autoload: { 'psr-4': { 'App\\': 'app/' } },
        });

        assert.strictEqual(generateNamespace('/project/database/migrations/CreateUsers.php', autoload), null);
    });
});
