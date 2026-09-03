import type { DetectedClassReference, ResolvedNamespace } from '../types';
import type { DeclarationParser } from './DeclarationParser';
import { generateUniqueImportAlias } from './ImportAliasGenerator';
import { ImportManager } from './ImportManager';
import type { PhpClassDetector } from './PhpClassDetector';
import { builtInClasses } from './builtInClasses';

export interface ImportAllOptions {
    autoAliasConflicts: boolean;
    aliasPrefixes: readonly string[];
    autoFixCase?: boolean;
}

export interface NamespaceLookup {
    resolve: (
        className: string,
        activeUri?: { fsPath: string }
    ) => Promise<ResolvedNamespace[]>;
}

const defaultOptions: ImportAllOptions = {
    autoAliasConflicts: false,
    aliasPrefixes: ['Base', 'Core'],
    autoFixCase: false,
};

interface ImportState {
    importedFqcns: Set<string>;
    occupiedNames: Set<string>;
}

function isSameNamespaceReference(
    namespace: string | null,
    className: string,
    resolved: ResolvedNamespace[]
): boolean {
    const expected = namespace === null ? className : `${namespace}\\${className}`;

    return resolved.some((item) => item.fqcn.toLowerCase() === expected.toLowerCase());
}

function isSameNamespaceFullyQualifiedReference(namespace: string | null, fqcn: string): boolean {
    const expected = namespace === null ? null : fqcn.split('\\').slice(0, -1).join('\\');

    return expected !== null && namespace !== null && expected.toLowerCase() === namespace.toLowerCase();
}

function withClassNameCase(fqcn: string, className: string): string {
    const parts = fqcn.split('\\');
    parts[parts.length - 1] = className;

    return parts.join('\\');
}

export async function normalizeImportedClassCase(
    text: string,
    parser: DeclarationParser,
    resolver: NamespaceLookup,
    activeUri?: { fsPath: string }
): Promise<string> {
    const importManager = new ImportManager(parser);
    const canonicalImports = new Map<string, string>();
    const imports = parser.parse(text).useStatements.filter((item) => item.kind === 'class');

    await Promise.all(imports.map(async (statement) => {
        const className = statement.fqcn.split('\\').pop() ?? statement.fqcn;
        const resolved = await resolver.resolve(className, activeUri);
        const canonical = resolved.find((item) =>
            item.fqcn.toLowerCase() === statement.fqcn.toLowerCase()
        );

        if (canonical !== undefined) {
            canonicalImports.set(statement.fqcn.toLowerCase(), canonical.fqcn);
        }
    }));

    return importManager.fixImportedClassCase(text, canonicalImports);
}

function importFullyQualifiedReferences(
    text: string,
    state: ImportState,
    references: readonly DetectedClassReference[],
    namespace: string | null,
    importManager: ImportManager,
    options: ImportAllOptions
): string {
    const fqcnsByName = new Map<string, Set<string>>();
    for (const reference of references) {
        const fqcn = reference.rawName.replace(/^\\+/, '');
        if (
            state.importedFqcns.has(fqcn.toLowerCase())
            || isSameNamespaceFullyQualifiedReference(namespace, fqcn)
        ) {
            continue;
        }

        const name = reference.name.toLowerCase();
        const fqcns = fqcnsByName.get(name) ?? new Set<string>();
        fqcns.add(fqcn.toLowerCase());
        fqcnsByName.set(name, fqcns);
    }
    const conflictingNames = new Set(
        [...fqcnsByName]
            .filter(([, fqcns]) => fqcns.size > 1)
            .map(([name]) => name)
    );

    for (const reference of references) {
        const fqcn = reference.rawName.replace(/^\\+/, '');
        if (state.importedFqcns.has(fqcn.toLowerCase())) {
            continue;
        }

        if (isSameNamespaceFullyQualifiedReference(namespace, fqcn)) {
            continue;
        }

        const referenceName = reference.name.toLowerCase();
        const hasConflict =
            state.occupiedNames.has(referenceName) || conflictingNames.has(referenceName);
        if (builtInClasses.has(reference.name) && !hasConflict) {
            continue;
        }

        if (hasConflict && !options.autoAliasConflicts) {
            continue;
        }

        const alias = hasConflict
            ? generateUniqueImportAlias(fqcn, state.occupiedNames, options.aliasPrefixes)
            : undefined;
        text = importManager.addImport(text, fqcn, alias);
        state.importedFqcns.add(fqcn.toLowerCase());
        state.occupiedNames.add((alias ?? reference.name).toLowerCase());
    }

    return text;
}

export async function computeImportAllText(
    text: string,
    parser: DeclarationParser,
    detector: PhpClassDetector,
    resolver: NamespaceLookup,
    activeUri?: { fsPath: string },
    options: ImportAllOptions = defaultOptions
): Promise<string> {
    const importManager = new ImportManager(parser);
    const parsed = parser.parse(text);
    const classImports = parsed.useStatements.filter((item) => item.kind === 'class');
    const declaredClassNames = new Map(
        parsed.declaredClassNames.map((className) => [className.toLowerCase(), className])
    );
    const sameNamespaceClassNames = new Map<string, string>();
    const state: ImportState = {
        importedFqcns: new Set(classImports.map((item) => item.fqcn.toLowerCase())),
        occupiedNames: new Set([
            ...classImports.map((item) => item.className.toLowerCase()),
            ...parsed.declaredClassNames.map((name) => name.toLowerCase()),
        ]),
    };
    const fullyQualifiedReferences = [
        ...detector.detectFullyQualifiedReferences(text),
        ...detector.detectFullyQualifiedPhpDocReferences(text),
        ...(parsed.namespace === null ? detector.detectQualifiedPhpDocReferences(text) : []),
    ];

    text = importFullyQualifiedReferences(
        text,
        state,
        fullyQualifiedReferences,
        parsed.namespace,
        importManager,
        options
    );

    for (const className of detector.detectAll(text)) {
        const declaredClassName = declaredClassNames.get(className.toLowerCase());
        if (options.autoFixCase && declaredClassName !== undefined) {
            sameNamespaceClassNames.set(className.toLowerCase(), declaredClassName);
        }

        if (state.occupiedNames.has(className.toLowerCase())) {
            continue;
        }

        const resolved = await resolver.resolve(className, activeUri);
        const sameNamespace = resolved.find((item) =>
            isSameNamespaceReference(parsed.namespace, className, [item])
        );
        if (sameNamespace !== undefined) {
            if (options.autoFixCase) {
                sameNamespaceClassNames.set(
                    className.toLowerCase(),
                    sameNamespace.fqcn.split('\\').pop() ?? sameNamespace.fqcn
                );
            }
            continue;
        }

        if (resolved.length === 1) {
            const fqcn = options.autoFixCase
                ? resolved[0].fqcn
                : withClassNameCase(resolved[0].fqcn, className);
            text = importManager.addImport(text, fqcn);
            state.importedFqcns.add(resolved[0].fqcn.toLowerCase());
            state.occupiedNames.add(className.toLowerCase());
        }
    }

    if (options.autoFixCase) {
        text = await normalizeImportedClassCase(text, parser, resolver, activeUri);
        text = importManager.fixClassCaseUsages(text, sameNamespaceClassNames);
    }

    return importManager.replaceImportedFullyQualifiedClasses(text);
}
