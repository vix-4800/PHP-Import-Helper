import type { DeclarationParser } from './DeclarationParser';
import { getInsertPosition } from './insertPosition';
import { PhpClassDetector } from './PhpClassDetector';
import type { UseStatement } from '../types';

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class ImportManager {
    private readonly detector = new PhpClassDetector();

    public constructor(private readonly parser: DeclarationParser) {}

    public addImport(text: string, fqcn: string, alias?: string): string {
        const parsed = this.parser.parse(text);
        const normalized = fqcn.replace(/^\\+/, '');

        if (parsed.useStatements.some((statement) => statement.fqcn === normalized)) {
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
                .map((item) => [item.fqcn, item.className])
        );
        const replacements = this.detector
            .detectFullyQualifiedReferences(text)
            .filter((item) => imported.has(item.rawName))
            .sort((left, right) => {
                if (left.line !== right.line) {
                    return right.line - left.line;
                }

                return right.character - left.character;
            });
        let result = text;

        for (const reference of replacements) {
            const alias = imported.get(reference.rawName);
            if (alias === undefined) {
                continue;
            }

            const start = this.offsetAt(result, reference.line, reference.character);
            result = `${result.slice(0, start)}${alias}${result.slice(start + reference.rawName.length + 1)}`;
        }

        return result;
    }

    public removeUnused(text: string): string {
        const parsed = this.parser.parse(text);
        const detected = new Set(this.detector.detectImportUsages(text));
        const lines = text.split(/\r?\n/);
        const replacements = new Map<number, { endLine: number; text: string }>();
        const handledRanges = new Set<string>();

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
            const kept = siblings.filter((item) => this.isUsed(detected, item));

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
        return detected.has(statement.className);
    }

    private renderUse(statement: UseStatement): string {
        const alias = statement.alias === null ? '' : ` as ${statement.alias}`;

        return `use ${statement.fqcn}${alias};`;
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
