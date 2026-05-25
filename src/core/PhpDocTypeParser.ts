export interface PhpDocTypeReference {
    name: string;
    rawName: string;
    fullyQualified: boolean;
    importName: string | null;
    importCandidate: boolean;
}

const scalarAndPseudoTypes = new Set([
    'array',
    'array-key',
    'bool',
    'boolean',
    'callable',
    'class-string',
    'false',
    'float',
    'int',
    'integer',
    'iterable',
    'key-of',
    'list',
    'mixed',
    'never',
    'non-empty-array',
    'non-empty-list',
    'null',
    'object',
    'parent',
    'self',
    'static',
    'string',
    'trait-string',
    'true',
    'value-of',
    'void',
]);

function isIdentifierStart(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
    return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function shortName(fqcn: string): string {
    return fqcn.split('\\').pop() ?? fqcn;
}

function readName(expression: string, start: number): { end: number; rawName: string; fullyQualified: boolean } | null {
    let index = start;
    const fullyQualified = expression[index] === '\\';
    if (fullyQualified) {
        index++;
    }

    if (!isIdentifierStart(expression[index])) {
        return null;
    }

    const parts: string[] = [];
    let allowDash = true;

    while (index < expression.length) {
        const partStart = index;
        index++;

        while (
            isIdentifierPart(expression[index]) ||
            (allowDash && expression[index] === '-' && isIdentifierStart(expression[index + 1]))
        ) {
            index++;
        }

        parts.push(expression.slice(partStart, index));
        allowDash = false;

        if (expression[index] !== '\\' || !isIdentifierStart(expression[index + 1])) {
            break;
        }

        index++;
    }

    return {
        end: index,
        rawName: parts.join('\\'),
        fullyQualified,
    };
}

function skipQuoted(expression: string, start: number): number {
    const quote = expression[start];
    let index = start + 1;

    while (index < expression.length) {
        if (expression[index] === '\\') {
            index += 2;
            continue;
        }

        if (expression[index] === quote) {
            return index + 1;
        }

        index++;
    }

    return expression.length;
}

function skipVariable(expression: string, start: number): number {
    let index = start + 1;

    while (isIdentifierPart(expression[index])) {
        index++;
    }

    return index;
}

function isShapeKey(expression: string, end: number): boolean {
    let index = end;

    while (/\s/.test(expression[index] ?? '')) {
        index++;
    }

    if (expression[index] === '?') {
        index++;
        while (/\s/.test(expression[index] ?? '')) {
            index++;
        }
    }

    return expression[index] === ':' && expression[index + 1] !== ':';
}

export function parsePhpDocTypeReferences(expression: string): PhpDocTypeReference[] {
    const result: PhpDocTypeReference[] = [];
    const seen = new Set<string>();
    let index = 0;

    while (index < expression.length) {
        const current = expression[index];

        if (current === '"' || current === "'") {
            index = skipQuoted(expression, index);
            continue;
        }

        if (current === '$') {
            index = skipVariable(expression, index);
            continue;
        }

        if (current !== '\\' && !isIdentifierStart(current)) {
            index++;
            continue;
        }

        const parsed = readName(expression, index);
        if (parsed === null) {
            index++;
            continue;
        }

        const { rawName, fullyQualified, end } = parsed;
        const normalized = rawName.replace(/^\\+|\\+$/g, '');
        const firstSegment = normalized.split('\\')[0] ?? normalized;
        const lowered = normalized.toLowerCase();
        const hasNamespaceSeparator = normalized.includes('\\');

        index = end;

        if (
            normalized === '' ||
            isShapeKey(expression, end) ||
            scalarAndPseudoTypes.has(lowered)
        ) {
            continue;
        }

        const name = fullyQualified ? shortName(normalized) : firstSegment;
        const importName = fullyQualified ? null : firstSegment;
        const importCandidate = !fullyQualified && !hasNamespaceSeparator;
        const key = `${name}:${normalized}:${fullyQualified}:${importCandidate}`;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        result.push({
            name,
            rawName: normalized,
            fullyQualified,
            importName,
            importCandidate,
        });
    }

    return result;
}
