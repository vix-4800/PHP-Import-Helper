import * as path from 'path';
import { DeclarationParser } from './DeclarationParser';
import type { AutoloadConfig } from './composer';
import { resolveNamespace } from './composer';

export function generateNamespace(filePath: string, autoload: AutoloadConfig): string | null {
    const directory = path.dirname(filePath);

    return resolveNamespace(directory, autoload);
}

export async function findNearestComposerPath(
    filePath: string,
    workspaceRoot: string,
    exists: (candidate: string) => Promise<boolean>
): Promise<string | null> {
    const root = path.resolve(workspaceRoot);
    let current = path.dirname(path.resolve(filePath));

    while (current.startsWith(root)) {
        const candidate = path.join(current, 'composer.json');

        if (await exists(candidate)) {
            return candidate;
        }

        if (current === root) {
            break;
        }

        current = path.dirname(current);
    }

    return null;
}

export function applyGeneratedNamespace(
    text: string,
    namespace: string,
    parser = new DeclarationParser()
): string {
    const parsed = parser.parse(text);
    const lines = text.split(/\r?\n/);
    const statement = `namespace ${namespace};`;

    if (parsed.declarationLines.namespace !== null) {
        const index = parsed.declarationLines.namespace - 1;
        lines[index] = lines[index].replace(/namespace\s+[^;]+;/, statement);

        return lines.join('\n');
    }

    const insertAfter = parsed.declarationLines.declare ?? parsed.declarationLines.phpTag;
    const insertIndex = insertAfter === 0 ? 0 : insertAfter;

    lines.splice(insertIndex, 0, '', statement);

    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}
