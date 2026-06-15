import type { DetectedClassReference, ResolvedNamespace } from '../types';
import type { DeclarationParser } from './DeclarationParser';
import { generateUniqueImportAlias } from './ImportAliasGenerator';
import { ImportManager } from './ImportManager';
import type { PhpClassDetector } from './PhpClassDetector';
import { builtInClasses } from './builtInClasses';

export interface ImportAllOptions {
    autoAliasConflicts: boolean;
    aliasPrefixes: readonly string[];
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

    return resolved.some((item) => item.fqcn === expected);
}

function isSameNamespaceFullyQualifiedReference(namespace: string | null, fqcn: string): boolean {
    const expected = namespace === null ? null : fqcn.split('\\').slice(0, -1).join('\\');

    return expected !== null && expected === namespace;
}

function importFullyQualifiedReferences(
    text: string,
    state: ImportState,
    references: readonly DetectedClassReference[],
    namespace: string | null,
    importManager: ImportManager,
    options: ImportAllOptions
): string {
    for (const reference of references) {
        const fqcn = reference.rawName.replace(/^\\+/, '');
        if (state.importedFqcns.has(fqcn.toLowerCase())) {
            continue;
        }

        if (isSameNamespaceFullyQualifiedReference(namespace, fqcn)) {
            continue;
        }

        const hasConflict = state.occupiedNames.has(reference.name.toLowerCase());
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
    const state: ImportState = {
        importedFqcns: new Set(classImports.map((item) => item.fqcn.toLowerCase())),
        occupiedNames: new Set([
            ...classImports.map((item) => item.className.toLowerCase()),
            ...parsed.declaredClassNames.map((name) => name.toLowerCase()),
        ]),
    };

    text = importFullyQualifiedReferences(
        text,
        state,
        detector.detectFullyQualifiedReferences(text),
        parsed.namespace,
        importManager,
        options
    );
    text = importFullyQualifiedReferences(
        text,
        state,
        detector.detectFullyQualifiedPhpDocReferences(text),
        parsed.namespace,
        importManager,
        options
    );
    if (parsed.namespace === null) {
        text = importFullyQualifiedReferences(
            text,
            state,
            detector.detectQualifiedPhpDocReferences(text),
            parsed.namespace,
            importManager,
            options
        );
    }

    for (const className of detector.detectAll(text)) {
        if (state.occupiedNames.has(className.toLowerCase())) {
            continue;
        }

        const resolved = await resolver.resolve(className, activeUri);
        if (isSameNamespaceReference(parsed.namespace, className, resolved)) {
            continue;
        }

        if (resolved.length === 1) {
            text = importManager.addImport(text, resolved[0].fqcn);
            state.importedFqcns.add(resolved[0].fqcn.toLowerCase());
            state.occupiedNames.add(className.toLowerCase());
        }
    }

    return importManager.replaceImportedFullyQualifiedClasses(text);
}
