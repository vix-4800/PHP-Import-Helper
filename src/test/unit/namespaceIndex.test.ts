import * as assert from 'assert';
import { NamespaceIndex } from '../../core/NamespaceIndex';

suite('NamespaceIndex', () => {
    test('stores multiple candidates for the same short class name', () => {
        const index = new NamespaceIndex();
        index.setEntries([
            {
                className: 'Request',
                fqcn: 'App\\Http\\Request',
                uri: { fsPath: '/project/app/Http/Request.php' },
            },
            {
                className: 'Request',
                fqcn: 'Vendor\\Http\\Request',
                uri: { fsPath: '/project/vendor/vendor/http/Request.php' },
            },
        ]);

        assert.deepStrictEqual(index.resolve('Request').map((item) => item.fqcn), [
            'App\\Http\\Request',
            'Vendor\\Http\\Request',
        ]);
    });

    test('classifies global, project, and vendor sources', () => {
        const index = new NamespaceIndex();
        index.setEntries([
            {
                className: 'GlobalUtility',
                fqcn: 'GlobalUtility',
                uri: { fsPath: '/project/vendor/tool/tool/library/GlobalUtility.php' },
            },
            {
                className: 'Controller',
                fqcn: 'App\\Http\\Controller',
                uri: { fsPath: '/project/app/Http/Controller.php' },
            },
            {
                className: 'Collection',
                fqcn: 'Vendor\\Support\\Collection',
                uri: { fsPath: '/project/vendor/package/framework/src/Vendor/Support/Collection.php' },
            },
        ]);

        assert.deepStrictEqual(index.resolve('GlobalUtility').map((item) => item.source), ['global']);
        assert.deepStrictEqual(index.resolve('Controller').map((item) => item.source), ['project']);
        assert.deepStrictEqual(index.resolve('Collection').map((item) => item.source), ['vendor']);
    });

    test('creates entries for every class-like declaration in a PHP file', () => {
        const entries = NamespaceIndex.entriesFromPhpFile(
            { fsPath: '/project/app/Domain/User.php' },
            `<?php

namespace App\\Domain;

final class User {}
interface UserRepository {}
trait HasUuid {}
enum Status: string {}
`
        );

        assert.deepStrictEqual(entries.map((entry) => entry.fqcn), [
            'App\\Domain\\User',
            'App\\Domain\\UserRepository',
            'App\\Domain\\HasUuid',
            'App\\Domain\\Status',
        ]);
    });

    test('creates global entries for files without namespace', () => {
        const entries = NamespaceIndex.entriesFromPhpFile(
            { fsPath: '/project/vendor/tool/tool/library/GlobalUtility.php' },
            `<?php

class GlobalUtility {}
`
        );

        assert.deepStrictEqual(entries, [
            {
                className: 'GlobalUtility',
                fqcn: 'GlobalUtility',
                uri: { fsPath: '/project/vendor/tool/tool/library/GlobalUtility.php' },
            },
        ]);
    });

    test('creates entries for bracketed namespaces', () => {
        const entries = NamespaceIndex.entriesFromPhpFile(
            { fsPath: '/project/app/Domain/User.php' },
            `<?php

namespace App\\Domain {
    final class User {}
    interface UserRepository {}
}
`
        );

        assert.deepStrictEqual(entries.map((entry) => entry.fqcn), [
            'App\\Domain\\User',
            'App\\Domain\\UserRepository',
        ]);
    });

    test('creates entries from every namespace block in one file', () => {
        const entries = NamespaceIndex.entriesFromPhpFile(
            { fsPath: '/project/app/Domain/Types.php' },
            `<?php

namespace App\\First {
    final class FirstType {}
}

namespace App\\Second {
    final class SecondType {}
}
`
        );

        assert.deepStrictEqual(entries.map((entry) => entry.fqcn), [
            'App\\First\\FirstType',
            'App\\Second\\SecondType',
        ]);
    });

    test('replaces entries for a changed file', () => {
        const index = new NamespaceIndex();
        const uri = { fsPath: '/project/app/Domain/User.php' };

        index.replaceFile(uri, [
            { className: 'User', fqcn: 'App\\Domain\\User', uri },
        ]);
        index.replaceFile(uri, [
            { className: 'Account', fqcn: 'App\\Domain\\Account', uri },
        ]);

        assert.deepStrictEqual(index.resolve('User'), []);
        assert.deepStrictEqual(index.resolve('Account').map((item) => item.fqcn), [
            'App\\Domain\\Account',
        ]);
    });

    test('removes entries for a deleted file', () => {
        const index = new NamespaceIndex();
        const uri = { fsPath: '/project/app/Domain/User.php' };

        index.setEntries([
            { className: 'User', fqcn: 'App\\Domain\\User', uri },
            {
                className: 'Post',
                fqcn: 'App\\Domain\\Post',
                uri: { fsPath: '/project/app/Domain/Post.php' },
            },
        ]);

        index.removeFile(uri);

        assert.deepStrictEqual(index.resolve('User'), []);
        assert.deepStrictEqual(index.resolve('Post').map((item) => item.fqcn), [
            'App\\Domain\\Post',
        ]);
    });

    test('removes a file without scanning unrelated class buckets', () => {
        const index = new NamespaceIndex();
        const targetUri = { fsPath: '/project/app/Domain/User.php' };
        const unrelatedEntries = Array.from({ length: 100 }, (_, indexValue) => ({
            className: `Unrelated${indexValue}`,
            fqcn: `App\\Domain\\Unrelated${indexValue}`,
            uri: { fsPath: `/project/app/Domain/Unrelated${indexValue}.php` },
        }));

        index.setEntries([
            { className: 'User', fqcn: 'App\\Domain\\User', uri: targetUri },
            ...unrelatedEntries,
        ]);

        const classBuckets = (index as unknown as {
            byClassName: Map<string, unknown>;
        }).byClassName;
        let iterations = 0;
        const originalEntries = classBuckets.entries.bind(classBuckets);
        classBuckets.entries = () => {
            iterations++;
            return originalEntries();
        };

        index.removeFile(targetUri);

        assert.strictEqual(iterations, 0);
        assert.deepStrictEqual(index.resolve('User'), []);
        assert.deepStrictEqual(index.resolve('Unrelated99').map((item) => item.fqcn), [
            'App\\Domain\\Unrelated99',
        ]);
    });
});
