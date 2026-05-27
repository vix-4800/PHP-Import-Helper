import * as assert from 'assert';
import type * as vscode from 'vscode';
import { getVisiblePhpDocuments } from '../../features/visiblePhpDocuments';

type TestDocument = {
    languageId: string;
    uri: {
        toString(): string;
    };
};

function document(languageId: string, uri: string): TestDocument {
    return {
        languageId,
        uri: {
            toString: () => uri,
        },
    };
}

function editor(doc: TestDocument): Pick<vscode.TextEditor, 'document'> {
    return {
        document: doc as vscode.TextDocument,
    };
}

suite('getVisiblePhpDocuments', () => {
    test('returns unique visible PHP documents only', () => {
        const first = document('php', 'file:///workspace/Foo.php');
        const second = document('typescript', 'file:///workspace/bar.ts');
        const third = document('php', 'file:///workspace/Baz.php');

        const result = getVisiblePhpDocuments([
            editor(first),
            editor(second),
            editor(first),
            editor(third),
        ]);

        assert.deepStrictEqual(result, [first, third]);
    });
});
