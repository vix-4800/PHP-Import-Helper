export interface AutoloadMapping {
    namespace: string;
    paths: string[];
}

export interface AutoloadConfig {
    psr4: AutoloadMapping[];
    psr0: AutoloadMapping[];
}

type ComposerSection = Record<string, string[] | string>;

function normalizeNamespace(namespace: string): string {
    return namespace.replace(/\\+$/, '');
}

function normalizePaths(value: string[] | string): string[] {
    const paths = Array.isArray(value) ? value : [value];

    return paths.map((path) => path.replace(/[\\/]+$/, ''));
}

function parseSection(section: unknown, key: 'psr-0' | 'psr-4'): AutoloadMapping[] {
    const mappings = (section as Record<string, ComposerSection> | undefined)?.[key] ?? {};

    return Object.entries(mappings).map(([namespace, paths]) => ({
        namespace: normalizeNamespace(namespace),
        paths: normalizePaths(paths),
    }));
}

export function parseAutoload(composer: unknown): AutoloadConfig {
    const root = composer as { autoload?: unknown; 'autoload-dev'?: unknown };

    const mergedPsr4 = new Map<string, string[]>();
    const mergedPsr0 = new Map<string, string[]>();

    for (const mapping of [
        ...parseSection(root.autoload, 'psr-4'),
        ...parseSection(root['autoload-dev'], 'psr-4'),
    ]) {
        mergedPsr4.set(mapping.namespace, mapping.paths);
    }

    for (const mapping of [
        ...parseSection(root.autoload, 'psr-0'),
        ...parseSection(root['autoload-dev'], 'psr-0'),
    ]) {
        mergedPsr0.set(mapping.namespace, mapping.paths);
    }

    return {
        psr4: [...mergedPsr4].map(([namespace, paths]) => ({ namespace, paths })),
        psr0: [...mergedPsr0].map(([namespace, paths]) => ({ namespace, paths })),
    };
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function findMatchingBase(
    filePath: string,
    mappingPath: string
): { index: number; length: number } | null {
    const normalizedFilePath = normalizePath(filePath);
    const normalizedMappingPath = normalizePath(mappingPath);
    const candidates = [...new Set([
        normalizedMappingPath,
        normalizedMappingPath.replace(/^\/+/, ''),
        `/${normalizedMappingPath.replace(/^\/+/, '')}`,
    ])];

    for (const candidate of candidates) {
        let index = normalizedFilePath.indexOf(candidate);

        while (index !== -1) {
            const beforeOk = index === 0 || normalizedFilePath[index - 1] === '/';
            const afterIndex = index + candidate.length;
            const afterOk =
                afterIndex === normalizedFilePath.length ||
                normalizedFilePath[afterIndex] === '/';

            if (beforeOk && afterOk) {
                return { index, length: candidate.length };
            }

            index = normalizedFilePath.indexOf(candidate, index + 1);
        }
    }

    return null;
}

function resolveFromMappings(
    filePath: string,
    mappings: AutoloadMapping[],
    psr0: boolean
): string | null {
    const normalized = normalizePath(filePath);

    for (const mapping of mappings) {
        for (const path of mapping.paths) {
            const matchedBase = findMatchingBase(normalized, path);

            if (matchedBase === null) {
                continue;
            }

            const remaining = normalized
                .slice(matchedBase.index + matchedBase.length)
                .replace(/^\/+/, '');
            const suffix = remaining === '' ? '' : `\\${remaining.replace(/\//g, '\\')}`;
            const remainingNamespace = remaining.replace(/\//g, '\\');
            const namespace =
                psr0 && remainingNamespace.startsWith(`${mapping.namespace}\\`)
                    ? remainingNamespace
                    : `${mapping.namespace}${suffix}`;

            return namespace.replace(/\\+$/, '');
        }
    }

    return null;
}

export function resolveNamespace(filePath: string, autoload: AutoloadConfig): string | null {
    return (
        resolveFromMappings(filePath, autoload.psr4, false) ??
        resolveFromMappings(filePath, autoload.psr0, true)
    );
}
