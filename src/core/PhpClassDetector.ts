import { builtInClasses } from './builtInClasses';
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

function extractTypeNames(typeExpression: string): string[] {
    return unique(
        [...typeExpression.matchAll(/\\?([A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*/g)]
            .map((match) => match[0].replace(/^\\+/, '').split('\\').pop() ?? '')
            .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
            .filter((name) => !scalarTypes.has(name.toLowerCase()))
    );
}

function phpDocTypeExpression(tag: string, body: string): string {
    if (tag === 'template') {
        return body.replace(/^[A-Za-z_][A-Za-z0-9_]*\s+of\s+/, '');
    }

    if (tag === 'param' || tag === 'var' || tag.startsWith('property')) {
        return body.replace(/\s+\$[A-Za-z_][A-Za-z0-9_]*.*$/, '');
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
            for (const lineMatch of comment.value.matchAll(
                /^\s*\*\s*@(param|return|var|throws|property(?:-read|-write)?|mixin|extends|implements|method|see|template)\s+(.+)$/gm
            )) {
                const tag = lineMatch[1];
                const body = lineMatch[2];
                const expression = phpDocTypeExpression(tag, body);

                for (const name of extractTypeNames(expression)) {
                    if (/^T[A-Z]/.test(name) && !expression.includes(`of ${name}`)) {
                        continue;
                    }

                    const index = lineMatch.index ?? 0;
                    const nameOffset = offset + comment.value.indexOf(name, index);
                    const importName = this.getImportUsageName(name);
                    found.push({
                        name,
                        rawName: name,
                        importName,
                        fullyQualified: false,
                        ...positionAt(text, nameOffset),
                    });
                }
            }
        }
    }

    private detectFallbackReferences(text: string): DetectedClassReference[] {
        const sanitized = sanitizePhpCode(text, { preservePhpDoc: true });
        const found: DetectedClassReference[] = [];

        const addMatches = (source: string, pattern: RegExp, group = 1): void => {
            for (const match of source.matchAll(pattern)) {
                const value = match[group];
                if (!value) {
                    continue;
                }

                const names = extractTypeNames(value);
                const baseOffset = (match.index ?? 0) + match[0].indexOf(value);

                for (const name of names) {
                    const importName = this.getImportUsageName(name);
                    if (importName === null) {
                        continue;
                    }

                    const offset = source.indexOf(name, baseOffset);
                    const pos = positionAt(text, offset === -1 ? baseOffset : offset);
                    found.push({
                        name,
                        rawName: name,
                        importName,
                        fullyQualified: false,
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
        addMatches(sanitized, /\bfunction\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\(([^)]*)\)/g);
        addMatches(sanitized, /\bfn\s*\(([^)]*)\)/g);
        addMatches(sanitized, /\)\s*:\s*([^{;=]+)/g);
        addMatches(
            sanitized,
            /\b(?:public|protected|private)(?:\s+(?:static|readonly|private\(set\)|protected\(set\)))*\s+([^$;=]+)\s+\$[A-Za-z_]/g
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

        for (const block of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
            const phpDoc = block[0];
            const offset = block.index ?? 0;

            for (const lineMatch of phpDoc.matchAll(
                /^\s*\*\s*@(param|return|var|throws|property(?:-read|-write)?|mixin|extends|implements|method|see|template)\s+(.+)$/gm
            )) {
                const tag = lineMatch[1];
                const body = lineMatch[2];
                const expression = phpDocTypeExpression(tag, body);

                for (const name of extractTypeNames(expression)) {
                    if (/^T[A-Z]/.test(name) && !expression.includes(`of ${name}`)) {
                        continue;
                    }

                    const nameOffset = offset + phpDoc.indexOf(name, lineMatch.index ?? 0);
                    const importName = this.getImportUsageName(name);
                    found.push({
                        name,
                        rawName: name,
                        importName,
                        fullyQualified: false,
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
        return item.importName !== null && !builtInClasses.has(item.importName);
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
