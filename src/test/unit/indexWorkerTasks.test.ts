import * as assert from 'assert';
import {
    decodePersistedIndex,
    encodePersistedIndex,
    parsePhpFiles,
} from '../../core/indexWorkerTasks';

suite('index worker tasks', () => {
    test('parses PHP files into serializable entries', () => {
        const results = parsePhpFiles([
            {
                uri: 'file:///workspace/app/Types.php',
                fsPath: '/workspace/app/Types.php',
                text: `<?php

namespace App\\First {
    final class FirstType {}
}

namespace App\\Second {
    interface SecondType {}
}
`,
            },
        ]);

        assert.deepStrictEqual(results, [
            {
                uri: 'file:///workspace/app/Types.php',
                entries: [
                    { className: 'FirstType', fqcn: 'App\\First\\FirstType' },
                    { className: 'SecondType', fqcn: 'App\\Second\\SecondType' },
                ],
            },
        ]);
    });

    test('encodes and decodes persisted index data', () => {
        const value = {
            version: 3,
            files: {
                'file:///workspace/app/User.php': {
                    mtime: 123,
                    entries: [{ className: 'User', fqcn: 'App\\User' }],
                },
            },
        };

        assert.deepStrictEqual(decodePersistedIndex(encodePersistedIndex(value)), value);
    });
});
