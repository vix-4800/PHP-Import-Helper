export interface PhpDocTypeReference {
    name: string;
    rawName: string;
    fullyQualified: boolean;
    importName: string | null;
    importCandidate: boolean;
}

const scalarAndPseudoTypes = new Set([
    'associative-array',
    'array',
    'array-key',
    'bool',
    'boolean',
    'callable',
    'callable-array',
    'callable-object',
    'callable-string',
    'class-string',
    'class-string-map',
    'closed-resource',
    'contravariant',
    'covariant',
    'decimal-int-string',
    'double',
    'empty',
    'empty-scalar',
    'enum-string',
    'false',
    'float',
    'int',
    'integer',
    'int-mask',
    'int-mask-of',
    'int-range',
    'interface-string',
    'iterable',
    'is',
    'key-of',
    'literal-int',
    'literal-string',
    'list',
    'lowercase-string',
    'max',
    'mixed',
    'min',
    'never',
    'never-return',
    'never-returns',
    'no-return',
    'non-decimal-int-string',
    'non-empty-array',
    'non-empty-list',
    'non-empty-literal-string',
    'non-empty-lowercase-string',
    'non-empty-mixed',
    'non-empty-scalar',
    'non-empty-string',
    'non-empty-uppercase-string',
    'non-falsy-string',
    'non-negative-int',
    'non-positive-int',
    'non-zero-int',
    'noreturn',
    'numeric',
    'numeric-string',
    'null',
    'object',
    'of',
    'open-resource',
    'parent',
    'positive-int',
    'properties-of',
    'pure-callable',
    'pure-closure',
    'resource',
    'scalar',
    'self',
    'static',
    'static-closure',
    'static-pure-closure',
    'string',
    'template-type',
    'trait-string',
    'true',
    'truthy-string',
    'uppercase-string',
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

function hasUnmatchedConditionalQuestion(expression: string, end: number): boolean {
    const questions = new Map<string, number>();
    let angleDepth = 0;
    let roundDepth = 0;
    let curlyDepth = 0;
    let squareDepth = 0;

    const depthKey = (): string => `${angleDepth}:${roundDepth}:${curlyDepth}:${squareDepth}`;

    for (let index = 0; index < end; index++) {
        const current = expression[index];

        if (current === '<') {
            angleDepth++;
            continue;
        }

        if (current === '>') {
            angleDepth = Math.max(0, angleDepth - 1);
            continue;
        }

        if (current === '(') {
            roundDepth++;
            continue;
        }

        if (current === ')') {
            roundDepth = Math.max(0, roundDepth - 1);
            continue;
        }

        if (current === '{') {
            curlyDepth++;
            continue;
        }

        if (current === '}') {
            curlyDepth = Math.max(0, curlyDepth - 1);
            continue;
        }

        if (current === '[') {
            squareDepth++;
            continue;
        }

        if (current === ']') {
            squareDepth = Math.max(0, squareDepth - 1);
            continue;
        }

        const key = depthKey();
        if (current === '?') {
            let next = index + 1;
            while (/\s/.test(expression[next] ?? '')) {
                next++;
            }

            if (expression[next] !== ':') {
                questions.set(key, (questions.get(key) ?? 0) + 1);
            }
            continue;
        }

        if (current === ':' && expression[index + 1] !== ':') {
            const count = questions.get(key) ?? 0;
            if (count > 0) {
                questions.set(key, count - 1);
            }
        }
    }

    return (questions.get(depthKey()) ?? 0) > 0;
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

    return (
        expression[index] === ':' &&
        expression[index + 1] !== ':' &&
        !hasUnmatchedConditionalQuestion(expression, index)
    );
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
