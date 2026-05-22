import type { SortMode, UseStatement } from '../types';
import type { DeclarationParser } from './DeclarationParser';

function naturalCompare(a: string, b: string): number {
    const aParts = a.split(/(\d+)/);
    const bParts = b.split(/(\d+)/);

    for (let index = 0; index < Math.min(aParts.length, bParts.length); index++) {
        const aPart = aParts[index];
        const bPart = bParts[index];

        if (aPart === bPart) {
            continue;
        }

        const aNumber = Number.parseInt(aPart, 10);
        const bNumber = Number.parseInt(bPart, 10);

        if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
            return aNumber - bNumber;
        }

        return aPart.localeCompare(bPart);
    }

    return aParts.length - bParts.length;
}

function compareUseStatements(mode: SortMode): (left: UseStatement, right: UseStatement) => number {
    return (left, right) => {
        if (left.kind !== right.kind) {
            return ['class', 'function', 'const'].indexOf(left.kind) - ['class', 'function', 'const'].indexOf(right.kind);
        }

        if (mode === 'length' && left.fqcn.length !== right.fqcn.length) {
            return left.fqcn.length - right.fqcn.length;
        }

        if (mode === 'natural') {
            return naturalCompare(left.fqcn, right.fqcn);
        }

        return left.fqcn.toLowerCase().localeCompare(right.fqcn.toLowerCase());
    };
}

function renderUse(statement: UseStatement): string {
    const kind = statement.kind === 'class' ? '' : `${statement.kind} `;
    const alias = statement.alias === null ? '' : ` as ${statement.alias}`;

    return `use ${kind}${statement.fqcn}${alias};`;
}

export class SortManager {
    public constructor(private readonly parser: DeclarationParser) {}

    public sortText(text: string, mode: SortMode): string {
        const parsed = this.parser.parse(text);

        if (parsed.useStatements.length < 2 || parsed.declarationLines.firstUseStatement === null || parsed.declarationLines.lastUseStatement === null) {
            throw new Error('Nothing to sort');
        }

        const sorted = [...parsed.useStatements].sort(compareUseStatements(mode));
        const groups: string[][] = [];

        for (const statement of sorted) {
            const lastGroup = groups[groups.length - 1];
            const rendered = renderUse(statement);

            if (lastGroup === undefined || sorted[sorted.findIndex((item) => renderUse(item) === lastGroup[0])]?.kind !== statement.kind) {
                groups.push([rendered]);
            } else {
                lastGroup.push(rendered);
            }
        }

        const newBlock = groups.map((group) => group.join('\n')).join('\n\n');
        const lines = text.split(/\r?\n/);
        lines.splice(
            parsed.declarationLines.firstUseStatement - 1,
            parsed.declarationLines.lastUseStatement - parsed.declarationLines.firstUseStatement + 1,
            newBlock,
        );

        return lines.join('\n');
    }
}
