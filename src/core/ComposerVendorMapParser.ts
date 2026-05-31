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
    let result = '';

    for (let index = 0; index < value.length; index++) {
        const char = value[index];

        if (char !== '\\') {
            result += char;
            continue;
        }

        const next = value[index + 1];
        if (next === '\\' || next === "'") {
            result += next;
            index++;
            continue;
        }

        result += char;
    }

    return result;
}

function findPhpSingleQuotedStringEnd(text: string, start: number): number {
    for (let index = start + 1; index < text.length; index++) {
        const char = text[index];

        if (char !== '\\') {
            if (char === "'") {
                return index;
            }

            continue;
        }

        const next = text[index + 1];
        if (next === '\\' || next === "'") {
            index++;
        }
    }

    return -1;
}

function parsePhpSingleQuotedString(value: string): string | null {
    if (!value.startsWith("'")) {
        return null;
    }

    const end = findPhpSingleQuotedStringEnd(value, 0);
    if (end !== value.length - 1) {
        return null;
    }

    return unescapePhpString(value.slice(1, -1));
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

        for (const { fqcn, expression } of this.findEntries(text)) {
            const fsPath = this.evaluatePathExpression(expression, variables);

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

    private *findEntries(text: string): Iterable<{ fqcn: string; expression: string }> {
        let index = 0;

        while (index < text.length) {
            const keyStart = text.indexOf("'", index);
            if (keyStart === -1) {
                return;
            }

            const keyEnd = findPhpSingleQuotedStringEnd(text, keyStart);
            if (keyEnd === -1) {
                return;
            }

            let cursor = keyEnd + 1;
            while (/\s/.test(text[cursor] ?? '')) {
                cursor++;
            }

            if (text.slice(cursor, cursor + 2) !== '=>') {
                index = keyEnd + 1;
                continue;
            }

            const fqcn = unescapePhpString(text.slice(keyStart + 1, keyEnd));
            cursor += 2;

            while (/\s/.test(text[cursor] ?? '')) {
                cursor++;
            }

            const expressionStart = cursor;
            while (cursor < text.length) {
                const char = text[cursor];

                if (char === "'") {
                    const stringEnd = findPhpSingleQuotedStringEnd(text, cursor);
                    if (stringEnd === -1) {
                        return;
                    }

                    cursor = stringEnd + 1;
                    continue;
                }

                if (char === ',' || char === '\r' || char === '\n') {
                    break;
                }

                cursor++;
            }

            const expression = text.slice(expressionStart, cursor).trim();
            if (expression !== '') {
                yield { fqcn, expression };
            }

            index = cursor + 1;
        }
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

            const stringValue = parsePhpSingleQuotedString(part);
            if (stringValue !== null) {
                resolved += stringValue;
                continue;
            }

            return null;
        }

        return normalizePath(resolved);
    }
}
