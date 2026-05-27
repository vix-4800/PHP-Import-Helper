import * as assert from 'assert';
import { NamespaceCacheUpdateQueue } from '../../core/NamespaceCacheUpdateQueue';

type TestUri = {
    scheme: string;
    fsPath: string;
    toString: () => string;
};

function uri(path: string, scheme = 'file'): TestUri {
    return {
        scheme,
        fsPath: path,
        toString: () => `${scheme}://${path}`,
    };
}

suite('NamespaceCacheUpdateQueue', () => {
    test('batches changed PHP files and de-duplicates by URI', () => {
        const queue = new NamespaceCacheUpdateQueue<TestUri>((value) =>
            value.scheme === 'file' && value.fsPath.endsWith('.php')
        );
        const first = uri('/workspace/src/User.php');
        const second = uri('/workspace/src/Post.php');

        assert.strictEqual(queue.addChanged(first), true);
        assert.strictEqual(queue.addChanged(first), false);
        assert.strictEqual(queue.addChanged(second), true);

        assert.deepStrictEqual(queue.consume(), {
            changed: [first, second],
            deleted: [],
        });
        assert.deepStrictEqual(queue.consume(), {
            changed: [],
            deleted: [],
        });
    });

    test('ignores non-PHP and non-file URIs', () => {
        const queue = new NamespaceCacheUpdateQueue<TestUri>((value) =>
            value.scheme === 'file' && value.fsPath.endsWith('.php')
        );

        assert.strictEqual(queue.addChanged(uri('/workspace/README.md')), false);
        assert.strictEqual(queue.addDeleted(uri('/workspace/src/User.php', 'untitled')), false);

        assert.deepStrictEqual(queue.consume(), {
            changed: [],
            deleted: [],
        });
    });

    test('delete overrides pending change for same URI', () => {
        const queue = new NamespaceCacheUpdateQueue<TestUri>((value) =>
            value.scheme === 'file' && value.fsPath.endsWith('.php')
        );
        const user = uri('/workspace/src/User.php');

        assert.strictEqual(queue.addChanged(user), true);
        assert.strictEqual(queue.addDeleted(user), true);

        assert.deepStrictEqual(queue.consume(), {
            changed: [],
            deleted: [user],
        });
    });
});
