import { builtInClasses } from './builtInClasses';
import { parsePhpDocBlocks, parsePhpDocTags, type PhpDocTag } from './PhpDocTagParser';
import { parsePhpDocTypeReferences, type PhpDocTypeReference } from './PhpDocTypeParser';
import {
    PhpAstParser,
    type PhpAstComment,
    type PhpAstDocument,
    type PhpAstLocation,
    type PhpAstNode,
} from './phpParser';
import { positionAt, unique } from './text';
import type { DetectedClassReference } from '../types';

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

function shortName(fqcn: string): string {
    return fqcn.split('\\').pop() ?? fqcn;
}

function extractTypeReferences(typeExpression: string): PhpDocTypeReference[] {
    return parsePhpDocTypeReferences(typeExpression);
}

function extractTypeNames(typeExpression: string): string[] {
    return unique(extractTypeReferences(typeExpression).map((item) => item.name));
}

function leadingPhpDocTypeExpression(body: string): string {
    const trimmed = body.trim();
    let angleDepth = 0;
    let roundDepth = 0;
    let curlyDepth = 0;
    let squareDepth = 0;

    for (let index = 0; index < trimmed.length; index++) {
        const current = trimmed[index];

        switch (current) {
            case '<':
                angleDepth++;
                continue;
            case '>':
                angleDepth = Math.max(0, angleDepth - 1);
                continue;
            case '(':
                roundDepth++;
                continue;
            case ')':
                roundDepth = Math.max(0, roundDepth - 1);
                continue;
            case '{':
                curlyDepth++;
                continue;
            case '}':
                curlyDepth = Math.max(0, curlyDepth - 1);
                continue;
            case '[':
                squareDepth++;
                continue;
            case ']':
                squareDepth = Math.max(0, squareDepth - 1);
                continue;
            default:
                break;
        }

        if (
            /\s/.test(current) &&
            angleDepth === 0 &&
            roundDepth === 0 &&
            curlyDepth === 0 &&
            squareDepth === 0
        ) {
            return trimmed.slice(0, index);
        }
    }

    return trimmed;
}

function methodPhpDocTypeExpression(body: string): string {
    const normalized = body.trim().replace(/^static\s+/, '');
    const openParen = normalized.indexOf('(');
    const closeParen = normalized.lastIndexOf(')');

    if (openParen === -1 || closeParen === -1 || closeParen < openParen) {
        return normalized;
    }

    const beforeParams = normalized.slice(0, openParen).trim();
    const params = normalized.slice(openParen + 1, closeParen);
    const match = /^(?:(.+?)\s+)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(beforeParams);

    if (match === null) {
        return normalized;
    }

    const returnType = match[1]?.trim() ?? '';
    const parameterTypes = params.replace(/\$[A-Za-z_][A-Za-z0-9_]*(?:\s*=\s*[^,]+)?/g, '');

    return [returnType, parameterTypes.trim()].filter((item) => item !== '').join(' ');
}

function extractPhpDocTagMatches(text: string): PhpDocTag[] {
    return parsePhpDocTags(text);
}

function fallbackParameterTypeExpression(parameterList: string): string {
    return parameterList
        .replace(/#\[[^\]]*\]\s*/g, ' ')
        .replace(/(?:&\s*)?(?:\.\.\.\s*)?\$[A-Za-z_][A-Za-z0-9_]*(?:\s*=\s*[^,]+)?/g, ' ');
}

function phpDocTypeExpression(tag: string, body: string): string {
    if (tag === 'template') {
        return body.replace(/^[A-Za-z_][A-Za-z0-9_]*\s+of\s+/, '');
    }

    if (tag === 'var') {
        return leadingPhpDocTypeExpression(body.replace(/\s+\$[A-Za-z_][A-Za-z0-9_]*.*$/, ''));
    }

    if (tag === 'param' || tag.startsWith('property')) {
        return body.replace(/\s+\$[A-Za-z_][A-Za-z0-9_]*.*$/, '');
    }

    if (tag === 'return' || tag === 'throws' || tag === 'mixin' || tag === 'see') {
        return leadingPhpDocTypeExpression(body);
    }

    if (tag === 'method') {
        return methodPhpDocTypeExpression(body);
    }

    return body;
}

export function sanitizePhpCode(text: string, options: { preservePhpDoc?: boolean } = {}): string {
    const chars = [...text];
    let index = 0;

    while (index < text.length) {
        const current = text[index];
        const next = text[index + 1];

        if (current === "'" || current === '"') {
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

        const heredoc = /^<<<'?([A-Za-z_][A-Za-z0-9_]*)'?/.exec(text.slice(index));

        if (heredoc) {
            const start = index;
            const marker = heredoc[1];
            const endPattern = new RegExp(`\\n[ \\t]*${marker};?`);
            const remaining = text.slice(index + heredoc[0].length);
            const endMatch = remaining.match(endPattern);
            index =
                endMatch?.index === undefined
                    ? text.length
                    : index + heredoc[0].length + endMatch.index + endMatch[0].length;
            blankRange(chars, start, index);
            continue;
        }

        index++;
    }

    return chars.join('');
}

export class PhpClassDetector {
    public constructor(private readonly parser = new PhpAstParser()) {}

    public detectAll(text: string): string[] {
        return unique(
            this.detectReferences(text)
                .filter((item) => this.isImportCandidate(item))
                .map((item) => item.name)
        );
    }

    public detectAllWithPositions(text: string): DetectedClassReference[] {
        return this.uniqueReferences(
            this.detectReferences(text).filter((item) => this.isImportCandidate(item))
        );
    }

    public detectImportUsages(text: string): string[] {
        return unique(
            this.detectReferences(text)
                .map((item) => item.importName)
                .filter((item): item is string => item !== null)
        );
    }

    public detectFullyQualifiedReferences(text: string): DetectedClassReference[] {
        return this.uniqueReferences(this.detectReferences(text).filter((item) => item.fullyQualified));
    }

    public detectFullyQualifiedPhpDocReferences(text: string): DetectedClassReference[] {
        const found: DetectedClassReference[] = [];

        for (const block of parsePhpDocBlocks(text)) {
            const phpDoc = block.text;
            const offset = block.index;

            for (const lineMatch of extractPhpDocTagMatches(phpDoc)) {
                const { tag, body } = lineMatch;
                const expression = phpDocTypeExpression(tag, body);

                for (const reference of extractTypeReferences(expression)) {
                    const { name, rawName, fullyQualified } = reference;
                    if (
                        !fullyQualified ||
                        builtInClasses.has(name) ||
                        (/^T[A-Z]/.test(name) && !expression.includes(`of ${name}`))
                    ) {
                        continue;
                    }

                    const searchValue = `\\${rawName}`;
                    const searchOffset = phpDoc.indexOf(searchValue, lineMatch.index);
                    const nameOffset = offset + (searchOffset === -1 ? lineMatch.index : searchOffset);
                    found.push({
                        name,
                        rawName,
                        importName: null,
                        fullyQualified: true,
                        ...positionAt(text, nameOffset),
                    });
                }
            }
        }

        return this.uniqueReferences(found);
    }

    public detectQualifiedPhpDocReferences(text: string): DetectedClassReference[] {
        const found: DetectedClassReference[] = [];

        for (const block of parsePhpDocBlocks(text)) {
            const phpDoc = block.text;
            const offset = block.index;

            for (const lineMatch of extractPhpDocTagMatches(phpDoc)) {
                const { tag, body } = lineMatch;
                const expression = phpDocTypeExpression(tag, body);

                for (const reference of extractTypeReferences(expression)) {
                    const { rawName, fullyQualified, importName, importCandidate } = reference;
                    if (fullyQualified || !rawName.includes('\\')) {
                        continue;
                    }

                    const searchOffset = phpDoc.indexOf(rawName, lineMatch.index);
                    const nameOffset = offset + (searchOffset === -1 ? lineMatch.index : searchOffset);
                    found.push({
                        name: shortName(rawName),
                        rawName,
                        importName,
                        fullyQualified: false,
                        importCandidate,
                        ...positionAt(text, nameOffset),
                    });
                }
            }
        }

        return this.uniqueReferences(found);
    }

    public detectReferences(text: string): DetectedClassReference[] {
        const document = this.parser.parse(text);
        const found = this.detectAstReferences(document);

        if (document.errors.length > 0) {
            found.push(...this.detectFallbackReferences(text));
        }

        return this.uniqueReferences(found);
    }

    private detectAstReferences(document: PhpAstDocument): DetectedClassReference[] {
        const found: DetectedClassReference[] = [];
        const processedComments = new Set<number>();

        this.parser.walk(document.program, (node) => {
            this.addPhpDocComments(found, node.leadingComments, processedComments, document.text);

            switch (node.kind) {
                case 'class':
                case 'interface':
                case 'trait':
                case 'enum':
                    this.addNodeList(found, node.extends);
                    this.addNodeList(found, node.implements);
                    this.addAttributeGroups(found, node.attrGroups);
                    return;
                case 'traituse':
                    this.addNodeList(found, node.traits);
                    return;
                case 'function':
                case 'method':
                case 'closure':
                case 'arrowfunc':
                    this.addTypeReference(found, node.type);
                    this.addAttributeGroups(found, node.attrGroups);
                    return;
                case 'parameter':
                case 'property':
                case 'classconstant':
                    this.addTypeReference(found, node.type);
                    this.addAttributeGroups(found, node.attrGroups);
                    return;
                case 'new':
                case 'staticlookup':
                    this.addNodeReference(found, node.what);
                    return;
                case 'bin':
                    if (node.type === 'instanceof') {
                        this.addNodeReference(found, node.right);
                    }
                    return;
                case 'catch':
                    this.addNodeList(found, node.what);
                    return;
                case 'attribute':
                    if (typeof node.name === 'string') {
                        this.addRawReference(found, node.name, node.loc);
                    }
                    return;
                default:
                    return;
            }
        });

        return found;
    }

    private addNodeList(found: DetectedClassReference[], value: unknown): void {
        if (Array.isArray(value)) {
            value.forEach((item) => this.addNodeReference(found, item));
            return;
        }

        this.addNodeReference(found, value);
    }

    private addNodeReference(found: DetectedClassReference[], value: unknown): void {
        if (this.parser.isName(value)) {
            this.addRawReference(found, value.name, value.loc);
        }
    }

    private addTypeReference(found: DetectedClassReference[], value: unknown): void {
        if (this.parser.isName(value)) {
            this.addRawReference(found, value.name, value.loc);
            return;
        }

        if (
            typeof value === 'object' &&
            value !== null &&
            'kind' in value &&
            typeof (value as { kind: unknown }).kind === 'string'
        ) {
            const node = value as PhpAstNode;

            if (node.kind === 'typereference' && typeof node.name === 'string') {
                this.addRawReference(found, node.name, node.loc);
                return;
            }

            if (
                (node.kind === 'uniontype' || node.kind === 'intersectiontype') &&
                Array.isArray(node.types)
            ) {
                node.types.forEach((item) => this.addTypeReference(found, item));
            }
        }
    }

    private addAttributeGroups(found: DetectedClassReference[], value: unknown): void {
        if (!Array.isArray(value)) {
            return;
        }

        for (const group of value) {
            if (
                typeof group === 'object' &&
                group !== null &&
                'attrs' in group &&
                Array.isArray((group as { attrs?: unknown[] }).attrs)
            ) {
                (group as { attrs: unknown[] }).attrs.forEach((item) => {
                    if (
                        typeof item === 'object' &&
                        item !== null &&
                        'kind' in item &&
                        (item as { kind: string }).kind === 'attribute'
                    ) {
                        const attribute = item as PhpAstNode;
                        if (typeof attribute.name === 'string') {
                            this.addRawReference(found, attribute.name, attribute.loc);
                        }
                    }
                });
            }
        }
    }

    private addRawReference(
        found: DetectedClassReference[],
        rawName: string,
        loc: PhpAstLocation | undefined
    ): void {
        if (loc === undefined) {
            return;
        }

        const fullyQualified = rawName.startsWith('\\');
        const normalized = rawName.replace(/^\\+|\\+$/g, '');
        if (normalized === '') {
            return;
        }

        const rawImportName = fullyQualified ? null : normalized.split('\\')[0] ?? null;
        const name = rawImportName ?? shortName(normalized);
        const importName = rawImportName === null ? null : this.getImportUsageName(rawImportName);
        if (rawImportName !== null && importName === null) {
            return;
        }

        found.push({
            name,
            rawName: normalized,
            importName,
            fullyQualified,
            line: loc.start.line - 1,
            character: loc.start.column,
        });
    }

    private addPhpDocComments(
        found: DetectedClassReference[],
        comments: PhpAstComment[] | undefined,
        processedComments: Set<number>,
        text: string
    ): void {
        for (const comment of comments ?? []) {
            const offset = comment.offset ?? comment.loc?.start.offset;
            if (offset === undefined || processedComments.has(offset) || comment.kind !== 'commentblock') {
                continue;
            }

            processedComments.add(offset);
            for (const lineMatch of extractPhpDocTagMatches(comment.value)) {
                const { tag, body } = lineMatch;
                const expression = phpDocTypeExpression(tag, body);

                for (const reference of extractTypeReferences(expression)) {
                    const { name, rawName, fullyQualified, importName, importCandidate } = reference;
                    if (/^T[A-Z]/.test(name) && !expression.includes(`of ${name}`)) {
                        continue;
                    }

                    const searchValue = fullyQualified ? `\\${rawName}` : rawName;
                    const nameOffset = offset + comment.value.indexOf(searchValue, lineMatch.index);
                    found.push({
                        name,
                        rawName,
                        importName,
                        fullyQualified,
                        importCandidate,
                        ...positionAt(text, nameOffset),
                    });
                }
            }
        }
    }

    private detectFallbackReferences(text: string): DetectedClassReference[] {
        const sanitized = sanitizePhpCode(text, { preservePhpDoc: true });
        const found: DetectedClassReference[] = [];

        const addMatches = (
            source: string,
            pattern: RegExp,
            group = 1,
            transform: (value: string) => string = (value) => value
        ): void => {
            for (const match of source.matchAll(pattern)) {
                const value = match[group];
                if (!value) {
                    continue;
                }

                const references = extractTypeReferences(transform(value));
                const baseOffset = (match.index ?? 0) + match[0].indexOf(value);

                for (const reference of references) {
                    const { name, rawName, fullyQualified, importName, importCandidate } = reference;
                    if (importName === null && !fullyQualified) {
                        continue;
                    }

                    const searchValue = fullyQualified ? `\\${rawName}` : rawName;
                    const offset = source.indexOf(searchValue, baseOffset);
                    const pos = positionAt(text, offset === -1 ? baseOffset : offset);
                    found.push({
                        name,
                        rawName,
                        importName,
                        fullyQualified,
                        importCandidate,
                        ...pos,
                    });
                }
            }
        };

        addMatches(
            sanitized,
            /\b(?:class|interface)\s+[A-Za-z_][A-Za-z0-9_]*\s+extends\s+([^{]+)/g
        );
        addMatches(
            sanitized,
            /\b(?:class|enum)\s+[A-Za-z_][A-Za-z0-9_]*(?::\s*\w+)?\s+implements\s+([^{]+)/g
        );
        addMatches(
            sanitized,
            /\bfunction\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\(([^)]*)\)/g,
            1,
            fallbackParameterTypeExpression
        );
        addMatches(sanitized, /\bfn\s*\(([^)]*)\)/g, 1, fallbackParameterTypeExpression);
        addMatches(
            sanitized,
            /\bfunction\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\([^)]*\)\s*:\s*([^{;=]+)/g
        );
        addMatches(sanitized, /\bfn\s*\([^)]*\)\s*:\s*([^=]+)=>/g);
        addMatches(
            sanitized,
            /\b(?:public|protected|private)(?![^\n;{]*\bfunction\b)(?:\s+(?:static|readonly|private\(set\)|protected\(set\)))*\s+([^$;=]+)\s+\$[A-Za-z_]/g
        );
        addMatches(
            sanitized,
            /\b(?:public|protected|private)?\s*const\s+([A-Za-z_][A-Za-z0-9_|\\&()?\s]*)\s+[A-Z_]/g
        );
        addMatches(sanitized, /\bnew\s+(?!class\b)(\\?[A-Za-z_][A-Za-z0-9_\\]*)/g);
        addMatches(sanitized, /(?<![$\\])\b([A-Za-z_][A-Za-z0-9_\\]*)::/g);
        addMatches(sanitized, /\binstanceof\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)/g);
        addMatches(sanitized, /\bcatch\s*\(([^)$]+)(?:\$[A-Za-z_][A-Za-z0-9_]*)?\)/g);
        addMatches(sanitized, /#\[(.*?)\]/gs);

        for (const block of parsePhpDocBlocks(text)) {
            const phpDoc = block.text;
            const offset = block.index;

            for (const lineMatch of extractPhpDocTagMatches(phpDoc)) {
                const { tag, body } = lineMatch;
                const expression = phpDocTypeExpression(tag, body);

                for (const reference of extractTypeReferences(expression)) {
                    const { name, rawName, fullyQualified, importName, importCandidate } = reference;
                    if (/^T[A-Z]/.test(name) && !expression.includes(`of ${name}`)) {
                        continue;
                    }

                    const searchValue = fullyQualified ? `\\${rawName}` : rawName;
                    const nameOffset = offset + phpDoc.indexOf(searchValue, lineMatch.index);
                    found.push({
                        name,
                        rawName,
                        importName,
                        fullyQualified,
                        importCandidate,
                        ...positionAt(text, nameOffset),
                    });
                }
            }
        }

        return found;
    }

    private getImportUsageName(name: string): string | null {
        return scalarTypes.has(name.toLowerCase()) ? null : name;
    }

    private isImportCandidate(item: DetectedClassReference): boolean {
        return (
            (item.importCandidate ?? true) &&
            item.importName !== null &&
            !builtInClasses.has(item.importName)
        );
    }

    private uniqueReferences(items: DetectedClassReference[]): DetectedClassReference[] {
        const seen = new Set<string>();

        return items.filter((item) => {
            const key = `${item.name}:${item.rawName}:${item.line}:${item.character}:${item.fullyQualified}`;
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
    }
}
