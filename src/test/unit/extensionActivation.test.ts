import * as assert from 'assert';
import Module = require('module');

type DisposableLike = {
    dispose(): void;
};

type VscodeStub = {
    languages: {
        registerCodeActionsProvider(): DisposableLike;
        registerFoldingRangeProvider(): DisposableLike;
    };
    workspace: {
        createFileSystemWatcher(): DisposableLike & {
            onDidCreate(): DisposableLike;
            onDidChange(): DisposableLike;
            onDidDelete(): DisposableLike;
        };
        onDidChangeConfiguration(): DisposableLike;
        onDidOpenTextDocument(): DisposableLike;
        onDidChangeTextDocument(): DisposableLike;
        onDidCloseTextDocument(): DisposableLike;
        onWillSaveTextDocument(): DisposableLike;
    };
    window: {
        createOutputChannel(): DisposableLike;
        createStatusBarItem(): DisposableLike;
        onDidChangeActiveTextEditor(): DisposableLike;
        visibleTextEditors: unknown[];
    };
    StatusBarAlignment: {
        Left: number;
    };
    CodeActionKind: {
        QuickFix: string;
    };
};

function disposable(): DisposableLike {
    return {
        dispose: () => undefined,
    };
}

function loadExtension(vscodeStub: VscodeStub): typeof import('../../extension') {
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

        if (request === './core/NamespaceCache') {
            return {
                NamespaceCache: class {
                    public readonly onDidChangeActivity = () => disposable();
                    public readonly onDidUpdate = () => disposable();
                    public clearLookups(): void {}
                    public initialize(): Promise<void> {
                        return Promise.resolve();
                    }
                },
            };
        }

        if (request === './features/AutoImportOnSave') {
            return {
                AutoImportOnSave: class {},
            };
        }

        if (request === './features/CacheStatusBarController') {
            return {
                CacheStatusBarController: class {
                    public handleActivity(): void {}
                },
            };
        }

        if (request === './features/CodeActionProvider') {
            return {
                PhpCodeActionProvider: class {},
            };
        }

        if (request === './features/DiagnosticManager') {
            return {
                DiagnosticManager: class {
                    public update(): void {}
                    public scheduleUpdate(): void {}
                    public clear(): void {}
                },
            };
        }

        if (request === './features/PerformanceMonitor') {
            return {
                PerformanceMonitor: class {},
            };
        }

        if (request === './features/commands') {
            return {
                createNamespaceResolver: () => ({
                    clearLookups: () => undefined,
                }),
                foldUsesInEditor: () => Promise.resolve(),
                registerCommands: () => undefined,
            };
        }

        if (request === './features/saveHooks') {
            return {
                computeSaveHookText: () => Promise.resolve(''),
            };
        }

        if (request === './features/visiblePhpDocuments') {
            return {
                getVisiblePhpDocuments: () => [],
            };
        }

        if (request === './utils/config') {
            return {
                getConfig: () => ({
                    get: <T>(_section: string, defaultValue: T) => defaultValue,
                }),
                ignoredClasses: () => [],
                importAllOptions: () => ({}),
                removeDuplicateImports: () => false,
                sortMode: () => 'natural',
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[require.resolve('../../extension')];

        return require('../../extension') as typeof import('../../extension');
    } finally {
        moduleLoader._load = originalLoad;
    }
}

suite('extension activation', () => {
    test('does not register a PHP folding range provider that replaces language server ranges', () => {
        let foldingProviderRegistrations = 0;
        const watcher = {
            ...disposable(),
            onDidCreate: () => disposable(),
            onDidChange: () => disposable(),
            onDidDelete: () => disposable(),
        };
        const vscodeStub: VscodeStub = {
            languages: {
                registerCodeActionsProvider: () => disposable(),
                registerFoldingRangeProvider: () => {
                    foldingProviderRegistrations++;

                    return disposable();
                },
            },
            workspace: {
                createFileSystemWatcher: () => watcher,
                onDidChangeConfiguration: () => disposable(),
                onDidOpenTextDocument: () => disposable(),
                onDidChangeTextDocument: () => disposable(),
                onDidCloseTextDocument: () => disposable(),
                onWillSaveTextDocument: () => disposable(),
            },
            window: {
                createOutputChannel: () => disposable(),
                createStatusBarItem: () => disposable(),
                onDidChangeActiveTextEditor: () => disposable(),
                visibleTextEditors: [],
            },
            StatusBarAlignment: {
                Left: 1,
            },
            CodeActionKind: {
                QuickFix: 'quickfix',
            },
        };
        const extension = loadExtension(vscodeStub);

        extension.activate({ subscriptions: [] } as never);

        assert.strictEqual(foldingProviderRegistrations, 0);
    });
});
