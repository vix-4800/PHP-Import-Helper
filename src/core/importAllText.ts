import type { DeclarationParser } from './DeclarationParser';
import { ImportManager } from './ImportManager';
import type { NamespaceCache } from './NamespaceCache';
import type { PhpClassDetector } from './PhpClassDetector';
import { builtInClasses } from './builtInClasses';
import type { DetectedClassReference, ResolvedNamespace } from '../types';

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
    imported: Set<string>,
    references: readonly DetectedClassReference[],
    namespace: string | null,
    importManager: ImportManager
): string {
    for (const reference of references) {
        if (imported.has(reference.name) || builtInClasses.has(reference.name)) {
            continue;
        }

        if (isSameNamespaceFullyQualifiedReference(namespace, reference.rawName)) {
            continue;
        }

        text = importManager.addImport(text, reference.rawName);
        imported.add(reference.name);
    }

    return text;
}

export function computeImportAllText(
    text: string,
    parser: DeclarationParser,
    detector: PhpClassDetector,
    cache: NamespaceCache
): string {
    const importManager = new ImportManager(parser);
    const parsed = parser.parse(text);
    const imported = new Set(
        parsed.useStatements
            .filter((item) => item.kind === 'class')
            .map((item) => item.className)
    );

    text = importFullyQualifiedReferences(
        text,
        imported,
        detector.detectFullyQualifiedReferences(text),
        parsed.namespace,
        importManager
    );
    text = importFullyQualifiedReferences(
        text,
        imported,
        detector.detectFullyQualifiedPhpDocReferences(text),
        parsed.namespace,
        importManager
    );

    for (const className of detector.detectAll(text)) {
        if (imported.has(className)) {
            continue;
        }

        const resolved = cache.resolve(className);
        if (isSameNamespaceReference(parsed.namespace, className, resolved)) {
            continue;
        }

        if (resolved.length === 1) {
            text = importManager.addImport(text, resolved[0].fqcn);
            imported.add(className);
        }
    }

    return importManager.replaceImportedFullyQualifiedClasses(text);
}
