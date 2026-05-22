export interface UseFoldingRange {
    startLine: number;
    endLine: number;
}

export class UseFoldingRangeCalculator {
    public calculate(lines: string[]): UseFoldingRange[] {
        const ranges: UseFoldingRange[] = [];
        let index = 0;
        let beforeDeclaration = true;

        while (index < lines.length) {
            const line = lines[index];

            if (/^\s*(?:class|interface|trait|enum)\b/.test(line)) {
                beforeDeclaration = false;
            }

            if (beforeDeclaration && /^\s*use\s+/.test(line)) {
                const start = index;
                let end = index;

                while (index < lines.length) {
                    if (/^\s*use\s+/.test(lines[index])) {
                        end = index;

                        if (!lines[index].includes(';')) {
                            while (index + 1 < lines.length && !lines[index].includes(';')) {
                                index++;
                                end = index;
                            }
                        }

                        index++;
                        continue;
                    }

                    if (lines[index].trim() === '') {
                        const next = lines[index + 1] ?? '';
                        if (/^\s*use\s+/.test(next)) {
                            index++;
                            continue;
                        }
                    }

                    break;
                }

                if (end > start) {
                    ranges.push({ startLine: start, endLine: end });
                }
                continue;
            }

            index++;
        }

        return ranges;
    }
}
