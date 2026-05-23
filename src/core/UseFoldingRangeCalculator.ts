import { DeclarationParser } from './DeclarationParser';

export interface UseFoldingRange {
    startLine: number;
    endLine: number;
}

export class UseFoldingRangeCalculator {
    public constructor(private readonly parser = new DeclarationParser()) {}

    public calculate(lines: string[]): UseFoldingRange[] {
        const blocks = [...new Map(
            this.parser
                .parse(lines.join('\n'))
                .useStatements.map((statement) => [
                    `${statement.line}:${statement.endLine}`,
                    { startLine: statement.line - 1, endLine: statement.endLine - 1 },
                ])
        ).values()].sort((left, right) => left.startLine - right.startLine);
        const ranges: UseFoldingRange[] = [];
        let current: UseFoldingRange | null = null;

        for (const block of blocks) {
            if (current === null) {
                current = { ...block };
                continue;
            }

            if (block.startLine <= current.endLine + 1) {
                current.endLine = Math.max(current.endLine, block.endLine);
                continue;
            }

            if (current.endLine > current.startLine) {
                ranges.push(current);
            }

            current = { ...block };
        }

        if (current !== null && current.endLine > current.startLine) {
            ranges.push(current);
        }

        return ranges;
    }
}
