import * as assert from 'assert';
import Module = require('module');

type TestPosition = {
    line: number;
    character: number;
};

type TestSelection = {
    anchor: TestPosition;
    active: TestPosition;
};

type TestLine = {
    text: string;
};

type TestDocument = {
    languageId: string;
    lineCount: number;
    lineAt(line: number): TestLine;
    getText(): string;
};

function loadCommands(vscodeStub: unknown): typeof import('../../features/commands') {
    const moduleLoader = Module as typeof Module & {
        _load(request: string, parent: NodeJS.Module | null, isMain: boolean): unknown;
    };
    const originalLoad = moduleLoader._load;

    moduleLoader._load = function patchedLoad(
        request: string,
        parent: NodeJS.Module | null,
        isMain: boolean
    ) {
        if (request === 'vscode') {
            return vscodeStub;
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[require.resolve('../../features/commands')];

        return require('../../features/commands') as typeof import('../../features/commands');
    } finally {
        moduleLoader._load = originalLoad;
    }
}

function document(lines: string[]): TestDocument {
    return {
        languageId: 'php',
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] }),
        getText: () => lines.join('\n'),
    };
}

suite('foldUsesInEditor', () => {
    test('creates manual import folds without registering a folding provider', async () => {
        let executedCommand: string | undefined;
        let commandSelections: TestSelection[] | undefined;
        const originalSelection = {
            anchor: { line: 5, character: 6 },
            active: { line: 5, character: 6 },
        };
        const editor = {
            document: document([
                '<?php',
                '',
                'use App\\Models\\User;',
                'use App\\Models\\Post;',
                '',
                'class Foo {}',
            ]),
            selections: [originalSelection],
        };
        const vscodeStub = {
            Position: class {
                public constructor(
                    public readonly line: number,
                    public readonly character: number
                ) {}
            },
            Selection: class {
                public constructor(
                    public readonly anchor: TestPosition,
                    public readonly active: TestPosition
                ) {}
            },
            commands: {
                executeCommand: (command: string) => {
                    executedCommand = command;
                    commandSelections = [...editor.selections];
                    editor.selections = [];

                    return Promise.resolve();
                },
            },
        };
        const { foldUsesInEditor } = loadCommands(vscodeStub);

        await foldUsesInEditor(editor as never);

        assert.strictEqual(executedCommand, 'editor.createFoldingRangeFromSelection');
        assert.deepStrictEqual(commandSelections?.map((selection) => ({
            anchor: { ...selection.anchor },
            active: { ...selection.active },
        })), [
            {
                anchor: { line: 2, character: 0 },
                active: { line: 3, character: 'use App\\Models\\Post;'.length },
            },
        ]);
        assert.deepStrictEqual(editor.selections, [originalSelection]);
    });
});
