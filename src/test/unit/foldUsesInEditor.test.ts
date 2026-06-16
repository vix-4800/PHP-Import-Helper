import * as assert from 'assert';
import Module = require('module');

type DisposableLike = {
    dispose(): void;
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

function disposable(onDispose: () => void): DisposableLike {
    return {
        dispose: onDispose,
    };
}

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
        delete require.cache[require.resolve('../../features/UseFoldingRangeProvider')];

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
    test('registers an import folding provider only while folding imports', async () => {
        let providerRegistered = false;
        let providerDisposed = false;
        let foldedSelectionLines: number[] | undefined;
        const vscodeStub = {
            FoldingRange: class {
                public constructor(
                    public readonly start: number,
                    public readonly end: number,
                    public readonly kind: string
                ) {}
            },
            FoldingRangeKind: {
                Imports: 'imports',
            },
            languages: {
                registerFoldingRangeProvider: (_selector: unknown, provider: {
                    provideFoldingRanges(document: TestDocument): unknown[];
                }) => {
                    providerRegistered = true;
                    const ranges = provider.provideFoldingRanges(document([
                        '<?php',
                        '',
                        'use App\\Models\\User;',
                        'use App\\Models\\Post;',
                        '',
                        'class Foo {}',
                    ]));

                    assert.strictEqual(ranges.length, 1);

                    return disposable(() => {
                        providerDisposed = true;
                    });
                },
            },
            commands: {
                executeCommand: (_command: string, options: { selectionLines: number[] }) => {
                    assert.strictEqual(providerRegistered, true);
                    assert.strictEqual(providerDisposed, false);
                    foldedSelectionLines = options.selectionLines;

                    return Promise.resolve();
                },
            },
        };
        const { foldUsesInEditor } = loadCommands(vscodeStub);

        await foldUsesInEditor({
            document: document([
                '<?php',
                '',
                'use App\\Models\\User;',
                'use App\\Models\\Post;',
                '',
                'class Foo {}',
            ]),
        } as never);

        assert.deepStrictEqual(foldedSelectionLines, [2]);
        assert.strictEqual(providerDisposed, true);
    });
});
