import { posix as path } from 'node:path';
import { parseAutoload } from './composer';

export interface ComposerIndexSourcePlan {
    projectRoots: string[];
    composerFiles: string[];
    dependencyFiles: string[];
    vendorMapFiles: string[];
}

export interface ComposerIndexSourcePlannerWorkspace {
    readFile: (filePath: string) => Promise<string>;
    pathExists: (filePath: string) => Promise<boolean>;
    findFiles: (root: string, fileName: string) => Promise<string[]>;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function dirname(filePath: string): string {
    return normalizePath(path.dirname(normalizePath(filePath)));
}

function isWithinPath(parent: string, target: string): boolean {
    const normalizedParent = normalizePath(parent);
    const normalizedTarget = normalizePath(target);

    return normalizedTarget === normalizedParent ||
        normalizedTarget.startsWith(`${normalizedParent}/`);
}

function relativePath(root: string, target: string): string | null {
    if (!isWithinPath(root, target)) {
        return null;
    }

    const normalizedRoot = normalizePath(root);
    const normalizedTarget = normalizePath(target);

    return normalizedRoot === normalizedTarget
        ? ''
        : normalizedTarget.slice(normalizedRoot.length + 1);
}

function matchesExclude(relative: string, excludePatterns: readonly string[]): boolean {
    return excludePatterns.some((pattern) => {
        if (path.matchesGlob(relative, pattern) || path.matchesGlob(`${relative}/index.php`, pattern)) {
            return true;
        }

        if (!pattern.startsWith('**/')) {
            return false;
        }

        const segments = relative.split('/');
        for (let index = 1; index < segments.length; index++) {
            if (path.matchesGlob(segments.slice(index).join('/'), pattern)) {
                return true;
            }
        }

        return false;
    });
}

function isExcluded(
    fsPath: string,
    workspaceRoots: readonly string[],
    excludePatterns: readonly string[]
): boolean {
    for (const root of workspaceRoots) {
        const relative = relativePath(root, fsPath);

        if (relative !== null) {
            return matchesExclude(relative, excludePatterns);
        }
    }

    return false;
}

function addUnique(values: Set<string>, items: readonly string[]): void {
    for (const item of items) {
        values.add(normalizePath(item));
    }
}

export class ComposerIndexSourcePlanner {
    public constructor(private readonly workspace: ComposerIndexSourcePlannerWorkspace) {}

    public async plan(
        workspaceRoots: readonly string[],
        excludePatterns: readonly string[]
    ): Promise<ComposerIndexSourcePlan> {
        const roots = workspaceRoots.map(normalizePath);
        const composerFiles = await this.findComposerFiles(roots, excludePatterns);
        const projectRoots = new Set<string>();
        const dependencyFiles = new Set<string>();
        const vendorMapFiles = new Set<string>();

        if (composerFiles.length === 0) {
            addUnique(projectRoots, await this.fallbackProjectRoots(roots, excludePatterns));
        }

        for (const composerFile of composerFiles) {
            const composerDir = dirname(composerFile);
            dependencyFiles.add(composerFile);
            dependencyFiles.add(`${composerDir}/composer.lock`);
            vendorMapFiles.add(`${composerDir}/vendor/composer/autoload_classmap.php`);
            vendorMapFiles.add(`${composerDir}/vendor/composer/autoload_static.php`);

            try {
                const autoload = parseAutoload(
                    JSON.parse(await this.workspace.readFile(composerFile)) as unknown,
                    composerDir
                );

                addUnique(projectRoots, [
                    ...autoload.psr4.flatMap((mapping) => mapping.paths),
                    ...autoload.psr0.flatMap((mapping) => mapping.paths),
                    ...autoload.classmap,
                ].filter((candidate) => !isExcluded(candidate, roots, excludePatterns)));
            } catch {
                continue;
            }
        }

        return {
            projectRoots: [...projectRoots].sort(),
            composerFiles,
            dependencyFiles: [...dependencyFiles, ...vendorMapFiles].sort(),
            vendorMapFiles: [...vendorMapFiles].sort(),
        };
    }

    private async findComposerFiles(
        workspaceRoots: readonly string[],
        excludePatterns: readonly string[]
    ): Promise<string[]> {
        const files = new Set<string>();

        for (const root of workspaceRoots) {
            for (const composerFile of await this.workspace.findFiles(root, 'composer.json')) {
                const normalized = normalizePath(composerFile);

                if (!isExcluded(normalized, workspaceRoots, excludePatterns)) {
                    files.add(normalized);
                }
            }
        }

        return [...files].sort();
    }

    private async fallbackProjectRoots(
        workspaceRoots: readonly string[],
        excludePatterns: readonly string[]
    ): Promise<string[]> {
        const roots: string[] = [];

        for (const workspaceRoot of workspaceRoots) {
            for (const fallbackName of ['app', 'src']) {
                const candidate = `${workspaceRoot}/${fallbackName}`;

                if (
                    !isExcluded(candidate, workspaceRoots, excludePatterns) &&
                    await this.workspace.pathExists(candidate)
                ) {
                    roots.push(candidate);
                }
            }
        }

        return roots;
    }
}
