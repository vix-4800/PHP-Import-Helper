import * as assert from 'assert';
import { getInsertPosition } from '../../core/insertPosition';
import type { DeclarationLines } from '../../types';

function lines(overrides: Partial<DeclarationLines>): DeclarationLines {
    return {
        phpTag: 1,
        declare: null,
        namespace: null,
        firstUseStatement: null,
        lastUseStatement: null,
        classDeclaration: null,
        ...overrides,
    };
}

suite('getInsertPosition', () => {
    test('inserts after namespace when no use statements exist', () => {
        assert.deepStrictEqual(getInsertPosition(lines({ namespace: 3 })), {
            line: 3,
            prepend: '\n',
            append: '\n',
        });
    });

    test('inserts after last use statement without prepending blank line', () => {
        assert.deepStrictEqual(getInsertPosition(lines({ namespace: 3, firstUseStatement: 5, lastUseStatement: 7 })), {
            line: 7,
            prepend: '',
            append: '\n',
        });
    });

    test('adds extra newline when class follows insertion line', () => {
        assert.deepStrictEqual(getInsertPosition(lines({ namespace: 3, classDeclaration: 4 })), {
            line: 3,
            prepend: '\n',
            append: '\n\n',
        });
    });
});
