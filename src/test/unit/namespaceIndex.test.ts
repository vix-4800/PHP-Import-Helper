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
                className: 'Mockery',
                fqcn: 'Mockery',
                uri: { fsPath: '/project/vendor/mockery/mockery/library/Mockery.php' },
            },
            {
                className: 'Controller',
                fqcn: 'App\\Http\\Controller',
                uri: { fsPath: '/project/app/Http/Controller.php' },
            },
            {
                className: 'Collection',
                fqcn: 'Illuminate\\Support\\Collection',
                uri: { fsPath: '/project/vendor/laravel/framework/src/Illuminate/Support/Collection.php' },
            },
        ]);

        assert.deepStrictEqual(index.resolve('Mockery').map((item) => item.source), ['global']);
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
            { fsPath: '/project/vendor/mockery/mockery/library/Mockery.php' },
            `<?php

class Mockery {}
`
        );

        assert.deepStrictEqual(entries, [
            {
                className: 'Mockery',
                fqcn: 'Mockery',
                uri: { fsPath: '/project/vendor/mockery/mockery/library/Mockery.php' },
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

    test('removes generated entries by source URI while preserving class URI', () => {
        const index = new NamespaceIndex();
        const sourceUri = { fsPath: '/project/vendor/composer/autoload_classmap.php' };
        const classUri = { fsPath: '/project/vendor/package/src/User.php' };

        index.replaceFile(sourceUri, [
            {
                className: 'User',
                fqcn: 'Vendor\\Package\\User',
                uri: classUri,
                sourceUri,
            },
        ]);

        assert.deepStrictEqual(index.resolve('User').map((item) => item.uri?.fsPath), [
            '/project/vendor/package/src/User.php',
        ]);

        index.removeFile(sourceUri);

        assert.deepStrictEqual(index.resolve('User'), []);
    });
});
