import * as assert from 'assert';
import { computeSaveHookText } from '../../features/saveHooks';

suite('save hooks text pipeline', () => {
    test('keeps prior edits when sorting has nothing to sort', async () => {
        const originalText = `<?php

class Foo extends Request {}
`;
        const text = await computeSaveHookText(originalText, {
            autoImportOnSave: true,
            removeOnSave: false,
            sortOnSave: true,
            sortMode: 'natural',
            ignoredClasses: [],
        }, {
            autoImportText: async () => `<?php

use App\\Http\\Request;

class Foo extends Request {}
`,
            removeUnusedText: (value: string) => value,
            sortText: () => {
                throw new Error('Nothing to sort');
            },
        });

        assert.ok(text.includes('use App\\Http\\Request;'));
    });
});
