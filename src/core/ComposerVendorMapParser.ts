import { posix as path } from 'node:path';
import type { CacheEntry } from '../types';

function normalizePath(filePath: string): string {
    return path.normalize(filePath.replace(/\\/g, '/'));
}

function dirname(filePath: string): string {
    return normalizePath(path.dirname(normalizePath(filePath)));
}

function shortName(fqcn: string): string {
    return fqcn.split('\\').pop() ?? fqcn;
}

function unescapePhpString(value: string): string {
    return value.replace(/\\\\/g, '\\').replace(/\\'/g, "'");
}

function uriForPath(fsPath: string): CacheEntry['uri'] {
    return {
        fsPath,
        toString: () => `file://${fsPath}`,
    } as CacheEntry['uri'];
}

function splitPhpConcat(expression: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inString = false;
    let escaped = false;

    for (const char of expression) {
        if (inString) {
            current += char;

            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (char === "'") {
                inString = false;
            }

            continue;
        }

        if (char === "'") {
            inString = true;
            current += char;
            continue;
        }

        if (char === '.') {
            parts.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    parts.push(current.trim());

    return parts;
}

export class ComposerVendorMapParser {
    public parse(mapFilePath: string, text: string): CacheEntry[] {
        const composerDir = dirname(mapFilePath);
        const vendorDir = dirname(composerDir);
        const baseDir = dirname(vendorDir);
        const variables = new Map<string, string>([
            ['__DIR__', composerDir],
            ['$vendorDir', vendorDir],
            ['$baseDir', baseDir],
        ]);
        const entries: CacheEntry[] = [];
        const entryPattern = /'((?:\\.|[^'])+)'\s*=>\s*([^,\r\n]+(?:\s*\.\s*[^,\r\n]+)*)/g;

        for (const match of text.matchAll(entryPattern)) {
            const fqcn = unescapePhpString(match[1]);
            const fsPath = this.evaluatePathExpression(match[2], variables);

            if (fsPath === null || fqcn === '') {
                continue;
            }

            entries.push({
                className: shortName(fqcn),
                fqcn,
                uri: uriForPath(fsPath),
            });
        }

        return entries;
    }

    private evaluatePathExpression(
        expression: string,
        variables: ReadonlyMap<string, string>
    ): string | null {
        const parts = splitPhpConcat(expression);
        let resolved = '';

        for (const part of parts) {
            if (variables.has(part)) {
                resolved += variables.get(part);
                continue;
            }

            const stringMatch = /^'((?:\\.|[^'])*)'$/.exec(part);
            if (stringMatch !== null) {
                resolved += unescapePhpString(stringMatch[1]);
                continue;
            }

            return null;
        }

        return normalizePath(resolved);
    }
}
