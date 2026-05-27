import * as assert from 'assert';
import Module = require('module');
import { DeclarationParser } from '../../core/DeclarationParser';
import { PhpClassDetector } from '../../core/PhpClassDetector';
import type { NamespaceCache } from '../../core/NamespaceCache';
import type { ResolvedNamespace } from '../../types';

type TestUri = {
    toString(): string;
};

type TestDocument = {
    languageId: string;
    uri: TestUri;
    version: number;
    getText(): string;
};

type DiagnosticCollectionLike = {
    set(uri: TestUri, diagnostics: unknown[]): void;
    delete(uri: TestUri): void;
    dispose(): void;
};

type VscodeStub = {
    languages: {
        createDiagnosticCollection(name: string): DiagnosticCollectionLike;
    };
    workspace: {
        getConfiguration(): {
            get<T>(section: string, defaultValue: T): T;
        };
    };
    Range: new (
        startLine: number,
        startCharacter: number,
        endLine: number,
        endCharacter: number
    ) => unknown;
    Diagnostic: new (range: unknown, message: string, severity: number) => {
        range: unknown;
        message: string;
        severity: number;
        code?: string;
        source?: string;
        tags?: number[];
    };
    DiagnosticSeverity: {
        Warning: number;
        Hint: number;
    };
    DiagnosticTag: {
        Unnecessary: number;
    };
};

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheWith(entries: Record<string, ResolvedNamespace[]>): NamespaceCache {
    return {
        resolve: (className: string) => entries[className] ?? [],
    } as unknown as NamespaceCache;
}

function uri(value: string): TestUri {
    return {
        toString: () => value,
    };
}

function documentWithText(text: string, version: number, targetUri: TestUri): TestDocument {
    return {
        languageId: 'php',
        uri: targetUri,
        version,
        getText: () => text,
    };
}

function loadDiagnosticManager(vscodeStub: VscodeStub): typeof import('../../features/DiagnosticManager') {
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
        delete require.cache[require.resolve('../../features/DiagnosticManager')];
        delete require.cache[require.resolve('../../utils/config')];

        return require('../../features/DiagnosticManager') as typeof import('../../features/DiagnosticManager');
    } finally {
        moduleLoader._load = originalLoad;
    }
}

suite('DiagnosticManager', () => {
    test('skips repeated analysis for same version unless forced', () => {
        const setCalls: Array<{ uri: TestUri; diagnostics: unknown[] }> = [];
        let parseCalls = 0;
        let detectCalls = 0;
        let importUsageCalls = 0;
        const vscodeStub: VscodeStub = {
            languages: {
                createDiagnosticCollection: () => ({
                    set: (targetUri, diagnostics) => setCalls.push({ uri: targetUri, diagnostics }),
                    delete: () => undefined,
                    dispose: () => undefined,
                }),
            },
            workspace: {
                getConfiguration: () => ({
                    get: <T>(_section: string, defaultValue: T) => defaultValue,
                }),
            },
            Range: class Range {
                public constructor(
                    public readonly startLine: number,
                    public readonly startCharacter: number,
                    public readonly endLine: number,
                    public readonly endCharacter: number
                ) {}
            },
            Diagnostic: class Diagnostic {
                public code?: string;
                public source?: string;
                public tags?: number[];

                public constructor(
                    public readonly range: unknown,
                    public readonly message: string,
                    public readonly severity: number
                ) {}
            },
            DiagnosticSeverity: {
                Warning: 0,
                Hint: 1,
            },
            DiagnosticTag: {
                Unnecessary: 1,
            },
        };
        const { DiagnosticManager } = loadDiagnosticManager(vscodeStub);
        const parser = {
            parse: (_text: string) => {
                parseCalls++;

                return {
                    namespace: null,
                    useStatements: [],
                    declaredClassNames: [],
                };
            },
        } as unknown as DeclarationParser;
        const detector = {
            detectAllWithPositions: (_text: string) => {
                detectCalls++;

                return [];
            },
            detectImportUsages: (_text: string) => {
                importUsageCalls++;

                return [];
            },
        } as unknown as PhpClassDetector;
        const manager = new DiagnosticManager(
            detector,
            parser,
            cacheWith({})
        );
        const document = documentWithText(`<?php

class Foo {}
`, 3, uri('file:///workspace/Foo.php'));

        manager.update(document as never);
        manager.update(document as never);
        manager.update(document as never, { force: true });

        assert.strictEqual(parseCalls, 2);
        assert.strictEqual(detectCalls, 2);
        assert.strictEqual(importUsageCalls, 2);
        assert.strictEqual(setCalls.length, 2);
    });

    test('debounces rapid document changes and uses latest version', async () => {
        const setCalls: Array<{ uri: TestUri; diagnostics: unknown[] }> = [];
        const vscodeStub: VscodeStub = {
            languages: {
                createDiagnosticCollection: () => ({
                    set: (targetUri, diagnostics) => setCalls.push({ uri: targetUri, diagnostics }),
                    delete: () => undefined,
                    dispose: () => undefined,
                }),
            },
            workspace: {
                getConfiguration: () => ({
                    get: <T>(section: string, defaultValue: T) =>
                        section === 'diagnostics.debounceMs' ? (0 as T) : defaultValue,
                }),
            },
            Range: class Range {
                public constructor(
                    public readonly startLine: number,
                    public readonly startCharacter: number,
                    public readonly endLine: number,
                    public readonly endCharacter: number
                ) {}
            },
            Diagnostic: class Diagnostic {
                public code?: string;
                public source?: string;
                public tags?: number[];

                public constructor(
                    public readonly range: unknown,
                    public readonly message: string,
                    public readonly severity: number
                ) {}
            },
            DiagnosticSeverity: {
                Warning: 0,
                Hint: 1,
            },
            DiagnosticTag: {
                Unnecessary: 1,
            },
        };
        const { DiagnosticManager } = loadDiagnosticManager(vscodeStub);
        const manager = new DiagnosticManager(
            new PhpClassDetector(),
            new DeclarationParser(),
            cacheWith({
                User: [{ fqcn: 'App\\Models\\User', source: 'project' }],
            })
        );
        const targetUri = uri('file:///workspace/UserController.php');

        manager.scheduleUpdate(
            documentWithText(`<?php

class Foo {
    public function handle(User $user): void {}
}
`, 1, targetUri) as never
        );
        manager.scheduleUpdate(
            documentWithText(`<?php

use App\\Models\\User;

class Foo {
    public function handle(User $user): void {}
}
`, 2, targetUri) as never
        );

        await wait(20);

        assert.strictEqual(setCalls.length, 1);
        assert.strictEqual(setCalls[0]?.uri, targetUri);
        assert.strictEqual(setCalls[0]?.diagnostics.length, 0);
    });

    test('clear cancels pending scheduled updates', async () => {
        const setCalls: Array<{ uri: TestUri; diagnostics: unknown[] }> = [];
        const deleted: TestUri[] = [];
        const vscodeStub: VscodeStub = {
            languages: {
                createDiagnosticCollection: () => ({
                    set: (targetUri, diagnostics) => setCalls.push({ uri: targetUri, diagnostics }),
                    delete: (targetUri) => deleted.push(targetUri),
                    dispose: () => undefined,
                }),
            },
            workspace: {
                getConfiguration: () => ({
                    get: <T>(section: string, defaultValue: T) =>
                        section === 'diagnostics.debounceMs' ? (0 as T) : defaultValue,
                }),
            },
            Range: class Range {
                public constructor(
                    public readonly startLine: number,
                    public readonly startCharacter: number,
                    public readonly endLine: number,
                    public readonly endCharacter: number
                ) {}
            },
            Diagnostic: class Diagnostic {
                public code?: string;
                public source?: string;
                public tags?: number[];

                public constructor(
                    public readonly range: unknown,
                    public readonly message: string,
                    public readonly severity: number
                ) {}
            },
            DiagnosticSeverity: {
                Warning: 0,
                Hint: 1,
            },
            DiagnosticTag: {
                Unnecessary: 1,
            },
        };
        const { DiagnosticManager } = loadDiagnosticManager(vscodeStub);
        const manager = new DiagnosticManager(
            new PhpClassDetector(),
            new DeclarationParser(),
            cacheWith({})
        );
        const targetUri = uri('file:///workspace/Foo.php');

        manager.scheduleUpdate(
            documentWithText(`<?php

class Foo extends MissingClass {}
`, 1, targetUri) as never
        );
        manager.clear(targetUri as never);

        await wait(20);

        assert.strictEqual(setCalls.length, 0);
        assert.deepStrictEqual(deleted, [targetUri]);
    });
});
