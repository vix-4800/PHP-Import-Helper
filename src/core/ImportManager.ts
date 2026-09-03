import type { UseStatement } from '../types';
import type { DeclarationParser } from './DeclarationParser';
import { getInsertPosition } from './insertPosition';
import { PhpClassDetector, sanitizePhpCode } from './PhpClassDetector';

export class ImportManager {
    private readonly detector = new PhpClassDetector();

    public constructor(private readonly parser: DeclarationParser) {}

    public addImport(text: string, fqcn: string, alias?: string): string {
        const parsed = this.parser.parse(text);
        const normalized = fqcn.replace(/^\\+/, '');

        if (parsed.useStatements.some((statement) => statement.fqcn.toLowerCase() === normalized.toLowerCase())) {
            return text;
        }

        const position = getInsertPosition(parsed.declarationLines);
        const importText = `use ${normalized}${alias === undefined ? '' : ` as ${alias}`};`;
        const lines = text.split(/\r?\n/);
        const insertIndex = position.line;
        const newText = `${position.prepend}${importText}${position.append}`;

        lines.splice(insertIndex, 0, newText.replace(/\n$/, ''));

        return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
    }

    public replaceImportedFullyQualifiedClasses(text: string): string {
        const imported = new Map(
            this.parser
            .parse(text)
                .useStatements.filter((item) => item.kind === 'class')
                .map((item) => [item.fqcn.toLowerCase(), item.className])
        );
        const sanitized = sanitizePhpCode(text, { preservePhpDoc: true });
        const replacements = [
            ...this.detector.detectFullyQualifiedReferences(text),
            ...this.detector.detectQualifiedPhpDocReferences(text),
        ]
            .filter((item) => imported.has(item.rawName.toLowerCase()))
            .filter((item) => {
                const start = this.offsetAt(sanitized, item.line, item.character);
                const qualifiedName = item.fullyQualified ? `\\${item.rawName}` : item.rawName;

                return sanitized.startsWith(qualifiedName, start);
            })
            .sort((left, right) => {
                if (left.line !== right.line) {
                    return right.line - left.line;
                }

                return right.character - left.character;
            });
        let result = text;

        for (const reference of replacements) {
            const alias = imported.get(reference.rawName.toLowerCase());
            if (alias === undefined) {
                continue;
            }

            const start = this.offsetAt(result, reference.line, reference.character);
            const length = reference.rawName.length + (reference.fullyQualified ? 1 : 0);
            result = `${result.slice(0, start)}${alias}${result.slice(start + length)}`;
        }

        return result;
    }

    public fixImportedClassCase(
        text: string,
        canonicalImports: ReadonlyMap<string, string>
    ): string {
        const parsed = this.parser.parse(text);
        const classImports = parsed.useStatements.filter((item) => item.kind === 'class');
        const canonicalNames = new Map<string, string>();

        for (const statement of classImports) {
            const canonical = canonicalImports.get(statement.fqcn.toLowerCase());
            if (canonical === undefined) {
                continue;
            }

            const canonicalName = canonical.split('\\').pop() ?? canonical;
            canonicalNames.set(
                statement.className.toLowerCase(),
                statement.alias ?? canonicalName
            );
        }

        const result = this.fixImportDeclarations(text, classImports, canonicalImports);
        return this.fixClassCaseUsages(result, canonicalNames);
    }

    public fixClassCaseUsages(
        text: string,
        canonicalNames: ReadonlyMap<string, string>
    ): string {
        let result = text;
        const sanitized = sanitizePhpCode(result, { preservePhpDoc: true });
        const replacements = this.detector.detectReferences(result)
            .filter((item) => !item.fullyQualified && item.importName !== null)
            .map((item) => ({
                reference: item,
                replacement: canonicalNames.get(item.importName!.toLowerCase()),
            }))
            .filter((item): item is { reference: ReturnType<PhpClassDetector['detectReferences']>[number]; replacement: string } =>
                item.replacement !== undefined && item.reference.importName !== item.replacement
            )
            .filter(({ reference }) => {
                const start = this.offsetAt(sanitized, reference.line, reference.character);

                return sanitized.startsWith(reference.importName!, start);
            })
            .sort((left, right) => {
                if (left.reference.line !== right.reference.line) {
                    return right.reference.line - left.reference.line;
                }

                return right.reference.character - left.reference.character;
            });

        for (const { reference, replacement } of replacements) {
            const start = this.offsetAt(result, reference.line, reference.character);
            const length = reference.importName!.length;
            result = `${result.slice(0, start)}${replacement}${result.slice(start + length)}`;
        }

        return result;
    }

    public removeUnused(
        text: string,
        ignoredClassNames: string[] = [],
        removeDuplicateImports = false
    ): string {
        const parsed = this.parser.parse(text);
        const detected = new Set(this.detector.detectImportUsages(text).map((item) => item.toLowerCase()));
        const ignored = new Set(ignoredClassNames);
        const lines = text.split(/\r?\n/);
        const replacements = new Map<number, { endLine: number; text: string }>();
        const handledRanges = new Set<string>();
        const seenImports = new Set<string>();

        for (const statement of parsed.useStatements.filter((item) => item.kind === 'class')) {
            const rangeKey = `${statement.line}:${statement.endLine}`;
            if (handledRanges.has(rangeKey)) {
                continue;
            }
            handledRanges.add(rangeKey);

            const siblings = parsed.useStatements.filter(
                (item) =>
                    item.line === statement.line &&
                    item.endLine === statement.endLine &&
                    item.kind === 'class'
            );
            const kept = siblings
                .filter((item) => ignored.has(item.className) || this.isUsed(detected, item))
                .filter((item) => {
                    if (!removeDuplicateImports) {
                        return true;
                    }

                    const importKey = `${item.kind}:${item.fqcn}:${item.alias ?? ''}`;
                    if (seenImports.has(importKey)) {
                        return false;
                    }

                    seenImports.add(importKey);

                    return true;
                });

            if (kept.length === siblings.length) {
                continue;
            }

            replacements.set(statement.line - 1, {
                endLine: statement.endLine - 1,
                text: kept.map((item) => this.renderUse(item)).join('\n'),
            });
        }

        const result: string[] = [];
        for (let index = 0; index < lines.length; index++) {
            const replacement = replacements.get(index);
            if (replacement !== undefined) {
                if (replacement.text !== '') {
                    result.push(replacement.text);
                }
                index = replacement.endLine;
                continue;
            }

            result.push(lines[index]);
        }

        return result.join('\n').replace(/\n{3,}/g, '\n\n');
    }

    private isUsed(detected: Set<string>, statement: UseStatement): boolean {
        return detected.has(statement.className.toLowerCase());
    }

    private renderUse(statement: UseStatement): string {
        const alias = statement.alias === null ? '' : ` as ${statement.alias}`;

        return `use ${statement.fqcn}${alias};`;
    }

    private fixImportDeclarations(
        text: string,
        imports: readonly UseStatement[],
        canonicalImports: ReadonlyMap<string, string>
    ): string {
        const lines = text.split(/\r?\n/);
        const statementsByRange = new Map<string, UseStatement[]>();

        for (const statement of imports) {
            if (canonicalImports.get(statement.fqcn.toLowerCase()) === undefined) {
                continue;
            }

            const key = `${statement.line}:${statement.endLine}`;
            const statements = statementsByRange.get(key) ?? [];
            statements.push(statement);
            statementsByRange.set(key, statements);
        }

        for (const statements of statementsByRange.values()) {
            const start = statements[0].line - 1;
            const end = statements[0].endLine;
            let declaration = lines.slice(start, end).join('\n');

            for (const statement of statements) {
                const canonical = canonicalImports.get(statement.fqcn.toLowerCase());
                if (canonical === undefined) {
                    continue;
                }

                const currentName = statement.fqcn.split('\\').pop() ?? statement.fqcn;
                const canonicalName = canonical.split('\\').pop() ?? canonical;
                if (currentName === canonicalName) {
                    continue;
                }

                declaration = declaration.replace(
                    new RegExp(
                        `(\\buse\\s+|[\\\\{,]\\s*)${this.escapeRegExp(currentName)}(?=\\s*(?:,|}|;|\\bas\\b))`,
                        'i'
                    ),
                    `$1${canonicalName}`
                );
            }

            lines.splice(start, end - start, ...declaration.split('\n'));
        }

        return lines.join('\n');
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private offsetAt(text: string, line: number, character: number): number {
        const lines = text.split('\n');
        let offset = 0;

        for (let index = 0; index < line; index++) {
            offset += lines[index]?.length ?? 0;
            offset += 1;
        }

        return offset + character;
    }
}
