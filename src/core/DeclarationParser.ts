import { getInsertPosition } from './insertPosition';
import type { DeclarationLines, ImportKind, ParseResult, UseStatement } from '../types';
import { getLines } from './text';

const classDeclarationPattern =
    /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/;

function parseUseStatement(text: string, line: number, endLine = line): UseStatement[] {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const match = /^use\s+(?:(function|const)\s+)?(.+);$/.exec(normalized);

    if (!match) {
        return [];
    }

    const kind = (match[1] ?? 'class') as ImportKind;
    const body = match[2].trim();
    if (body.includes('{') && body.includes('}')) {
        const prefix = body.slice(0, body.indexOf('{')).replace(/\\+$/, '');
        const entries = body.slice(body.indexOf('{') + 1, body.lastIndexOf('}'));

        return entries
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
            .map((entry) => parseSingleUse(`${prefix}\\${entry}`, kind, text, line, endLine))
            .filter(Boolean) as UseStatement[];
    }

    return [parseSingleUse(body, kind, text, line, endLine)].filter(Boolean) as UseStatement[];
}

function parseSingleUse(
    body: string,
    kind: ImportKind,
    text: string,
    line: number,
    endLine: number
): UseStatement | null {
    const match = /^(.+?)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/i.exec(body.trim());

    if (!match) {
        return null;
    }

    const fqcn = match[1].replace(/^\\+|\\+$/g, '');
    const alias = match[2] ?? null;
    const shortName = fqcn.split('\\').pop() ?? fqcn;

    return {
        text,
        line,
        endLine,
        fqcn,
        alias,
        className: alias ?? shortName,
        kind,
    };
}

export class DeclarationParser {
    public parse(text: string, ensureNotImported?: string): ParseResult {
        const lines = getLines(text);
        const declarationLines: DeclarationLines = {
            phpTag: 0,
            declare: null,
            namespace: null,
            firstUseStatement: null,
            lastUseStatement: null,
            classDeclaration: null,
        };
        const useStatements: UseStatement[] = [];
        const declaredClassNames: string[] = [];
        let namespace: string | null = null;

        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            const oneBased = index + 1;

            if (declarationLines.phpTag === 0 && /^\s*<\?php\b/.test(line)) {
                declarationLines.phpTag = oneBased;
            }

            if (declarationLines.declare === null && /^\s*declare\s*\(/.test(line)) {
                declarationLines.declare = oneBased;
            }

            const namespaceMatch = /^\s*(?:<\?php\s+)?namespace\s+([^;]+);/.exec(line);

            if (namespaceMatch && declarationLines.namespace === null) {
                namespace = namespaceMatch[1].trim();
                declarationLines.namespace = oneBased;
            }

            const classMatch = classDeclarationPattern.exec(line);

            if (classMatch) {
                declarationLines.classDeclaration = oneBased;
                declaredClassNames.push(classMatch[1]);
                break;
            }

            if (/^\s*use\s+/.test(line)) {
                let block = line;
                let endIndex = index;

                while (!block.includes(';') && endIndex + 1 < lines.length) {
                    endIndex++;
                    block += `\n${lines[endIndex]}`;
                }

                const parsed = parseUseStatement(block, oneBased, endIndex + 1);

                if (parsed.length > 0) {
                    declarationLines.firstUseStatement ??= oneBased;
                    declarationLines.lastUseStatement = endIndex + 1;
                    useStatements.push(...parsed);
                    index = endIndex;
                }
            }
        }

        if (
            ensureNotImported !== undefined &&
            useStatements.some(
                (statement) => statement.fqcn === ensureNotImported.replace(/^\\+/, '')
            )
        ) {
            throw new Error(`${ensureNotImported} is already imported`);
        }

        return {
            namespace,
            declarationLines,
            useStatements,
            declaredClassNames,
        };
    }

    public getImportedClassNames(text: string): string[] {
        return this.parse(text)
            .useStatements.filter((statement) => statement.kind === 'class')
            .map((statement) => statement.className);
    }

    public getDeclaredClassNames(text: string): string[] {
        return this.parse(text).declaredClassNames;
    }

    public getImportedClassName(text: string, fqcn: string): string | null {
        const normalized = fqcn.replace(/^\\+/, '');
        const statement = this.parse(text).useStatements.find((item) => item.fqcn === normalized);

        return statement?.className ?? null;
    }

    public getInsertPosition(declarationLines: DeclarationLines) {
        return getInsertPosition(declarationLines);
    }
}
