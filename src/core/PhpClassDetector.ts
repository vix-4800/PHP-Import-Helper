import { builtInClasses } from './builtInClasses';
import { positionAt, unique } from './text';
import type { DetectedClass } from '../types';

const scalarTypes = new Set([
    'array',
    'bool',
    'boolean',
    'callable',
    'false',
    'float',
    'int',
    'integer',
    'iterable',
    'mixed',
    'never',
    'null',
    'object',
    'self',
    'static',
    'string',
    'true',
    'void',
]);

function blankRange(chars: string[], start: number, end: number): void {
    for (let index = start; index < end; index++) {
        if (chars[index] !== '\n' && chars[index] !== '\r') {
            chars[index] = ' ';
        }
    }
}

export function sanitizePhpCode(text: string, options: { preservePhpDoc?: boolean } = {}): string {
    const chars = [...text];
    let index = 0;

    while (index < text.length) {
        const current = text[index];
        const next = text[index + 1];

        if (current === '\'' || current === '"') {
            const quote = current;
            const start = index;
            index++;

            while (index < text.length) {
                if (text[index] === '\\') {
                    index += 2;
                    continue;
                }

                if (text[index] === quote) {
                    index++;
                    break;
                }

                index++;
            }

            blankRange(chars, start, index);
            continue;
        }

        if (current === '/' && next === '/') {
            const start = index;
            while (index < text.length && text[index] !== '\n') {
                index++;
            }
            blankRange(chars, start, index);
            continue;
        }

        if (current === '#' && next !== '[') {
            const start = index;
            while (index < text.length && text[index] !== '\n') {
                index++;
            }
            blankRange(chars, start, index);
            continue;
        }

        if (current === '/' && next === '*') {
            const start = index;
            const isPhpDoc = text[index + 2] === '*';
            index += 2;
            while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
                index++;
            }
            index = Math.min(index + 2, text.length);
            if (!options.preservePhpDoc || !isPhpDoc) {
                blankRange(chars, start, index);
            }
            continue;
        }

        const heredoc = text.slice(index).match(/^<<<'?([A-Za-z_][A-Za-z0-9_]*)'?/);

        if (heredoc) {
            const start = index;
            const marker = heredoc[1];
            const endPattern = new RegExp(`\\n[ \\t]*${marker};?`);
            const remaining = text.slice(index + heredoc[0].length);
            const endMatch = remaining.match(endPattern);
            index = endMatch?.index === undefined
                ? text.length
                : index + heredoc[0].length + endMatch.index + endMatch[0].length;
            blankRange(chars, start, index);
            continue;
        }

        index++;
    }

    return chars.join('');
}

function extractTypeNames(typeExpression: string): string[] {
    return unique([...typeExpression.matchAll(/\\?([A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*/g)]
        .map((match) => match[0].replace(/^\\+/, '').split('\\').pop() ?? '')
        .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        .filter((name) => !scalarTypes.has(name.toLowerCase())));
}

export class PhpClassDetector {
    public detectAll(text: string): string[] {
        return unique(this.detectAllWithPositions(text).map((item) => item.name));
    }

    public detectAllWithPositions(text: string): DetectedClass[] {
        const sanitized = sanitizePhpCode(text, { preservePhpDoc: true });
        const found: DetectedClass[] = [];

        const addMatches = (source: string, pattern: RegExp, group = 1): void => {
            for (const match of source.matchAll(pattern)) {
                const value = match[group];
                if (!value) {
                    continue;
                }

                const names = extractTypeNames(value);
                const baseOffset = (match.index ?? 0) + match[0].indexOf(value);

                for (const name of names) {
                    if (builtInClasses.has(name) && !/JsonSerializable|Stringable|Countable|Iterator|RuntimeException|DomainException/.test(name)) {
                        continue;
                    }

                    const offset = source.indexOf(name, baseOffset);
                    const pos = positionAt(text, offset === -1 ? baseOffset : offset);
                    found.push({ name, ...pos });
                }
            }
        };

        addMatches(sanitized, /\b(?:class|interface)\s+[A-Za-z_][A-Za-z0-9_]*\s+extends\s+([^{]+)/g);
        addMatches(sanitized, /\b(?:class|enum)\s+[A-Za-z_][A-Za-z0-9_]*(?::\s*\w+)?\s+implements\s+([^{]+)/g);
        addMatches(sanitized, /\bfunction\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\(([^)]*)\)/g);
        addMatches(sanitized, /\bfn\s*\(([^)]*)\)/g);
        addMatches(sanitized, /\)\s*:\s*([^{;=]+)/g);
        addMatches(sanitized, /\b(?:public|protected|private)(?:\s+(?:static|readonly|private\(set\)|protected\(set\)))*\s+([^$;=]+)\s+\$[A-Za-z_]/g);
        addMatches(sanitized, /\b(?:public|protected|private)?\s*const\s+([A-Za-z_][A-Za-z0-9_|\\&()?\s]*)\s+[A-Z_]/g);
        addMatches(sanitized, /\bnew\s+(?!class\b)(\\?[A-Za-z_][A-Za-z0-9_\\]*)/g);
        addMatches(sanitized, /(?<![$\\])\b([A-Za-z_][A-Za-z0-9_\\]*)::/g);
        addMatches(sanitized, /\binstanceof\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)/g);
        addMatches(sanitized, /\bcatch\s*\(([^)$]+)(?:\$[A-Za-z_][A-Za-z0-9_]*)?\)/g);
        addMatches(sanitized, /#\[(.*?)\]/gs);
        addMatches(sanitized, /^\s*use\s+([^;{]+)[;{]/gm);

        for (const block of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
            const phpDoc = block[0];
            const offset = block.index ?? 0;

            for (const lineMatch of phpDoc.matchAll(/^\s*\*\s*@(param|return|var|throws|property(?:-read|-write)?|mixin|extends|implements|method|see|template)\s+(.+)$/gm)) {
                const tag = lineMatch[1];
                const body = lineMatch[2];
                const expression = tag === 'template'
                    ? body.replace(/^[A-Za-z_][A-Za-z0-9_]*\s+of\s+/, '')
                    : body;

                for (const name of extractTypeNames(expression)) {
                    if (/^T[A-Z]/.test(name) && !expression.includes(`of ${name}`)) {
                        continue;
                    }

                    const nameOffset = offset + phpDoc.indexOf(name, lineMatch.index ?? 0);
                    found.push({ name, ...positionAt(text, nameOffset) });
                }
            }
        }

        const filtered = found.filter((item) => {
            const line = text.split(/\r?\n/)[item.line] ?? '';

            return !/^(?:namespace|use\s)/.test(line);
        });

        const seen = new Set<string>();

        return filtered.filter((item) => {
            const key = `${item.name}:${item.line}:${item.character}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }
}
