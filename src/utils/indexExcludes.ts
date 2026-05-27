import { posix as path } from 'node:path';

export const defaultIndexExcludePatterns = [
    '**/.git/**',
    '**/node_modules/**',
    '**/vendor/**',
    '**/var/cache/**',
    '**/runtime/**',
    '**/storage/framework/**',
    '**/bootstrap/cache/**',
];

function normalizeFsPath(fsPath: string): string {
    const normalized = fsPath.replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isWithinPath(parent: string, target: string): boolean {
    const normalizedParent = normalizeFsPath(parent);
    const normalizedTarget = normalizeFsPath(target);

    return normalizedTarget === normalizedParent ||
        normalizedTarget.startsWith(`${normalizedParent}/`);
}

export function isWithinRoots(fsPath: string, roots: readonly string[]): boolean {
    return roots.some((root) => isWithinPath(root, fsPath));
}

function relativePathFromRoots(fsPath: string, roots: readonly string[]): string | null {
    const normalizedTarget = normalizeFsPath(fsPath);

    for (const root of roots) {
        if (!isWithinPath(root, normalizedTarget)) {
            continue;
        }

        const normalizedRoot = normalizeFsPath(root);
        return normalizedTarget === normalizedRoot
            ? ''
            : normalizedTarget.slice(normalizedRoot.length + 1);
    }

    return null;
}

function matchesExcludePattern(relativePath: string, excludePatterns: readonly string[]): boolean {
    return excludePatterns.some((pattern) => {
        if (path.matchesGlob(relativePath, pattern)) {
            return true;
        }

        if (!pattern.startsWith('**/')) {
            return false;
        }

        const segments = relativePath.split('/');
        for (let index = 1; index < segments.length; index++) {
            if (path.matchesGlob(segments.slice(index).join('/'), pattern)) {
                return true;
            }
        }

        return false;
    });
}

export function shouldIncludePhpFile(
    fsPath: string,
    roots: readonly string[],
    excludePatterns: readonly string[]
): boolean {
    if (!fsPath.endsWith('.php')) {
        return false;
    }

    const relativePath = relativePathFromRoots(fsPath, roots);
    if (relativePath === null) {
        return false;
    }

    return !matchesExcludePattern(relativePath, excludePatterns);
}

export function buildIndexExcludeGlob(excludePatterns: readonly string[]): string | undefined {
    if (excludePatterns.length === 0) {
        return undefined;
    }

    return excludePatterns.length === 1
        ? excludePatterns[0]
        : `{${excludePatterns.join(',')}}`;
}
