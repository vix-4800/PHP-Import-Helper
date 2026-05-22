export function getLines(text: string): string[] {
    return text.split(/\r?\n/);
}

export function lineOffsets(text: string): number[] {
    const offsets = [0];

    for (let index = 0; index < text.length; index++) {
        if (text[index] === '\n') {
            offsets.push(index + 1);
        }
    }

    return offsets;
}

export function positionAt(text: string, offset: number): { line: number; character: number } {
    const offsets = lineOffsets(text);
    let line = 0;

    for (let index = 0; index < offsets.length; index++) {
        if (offsets[index] > offset) {
            break;
        }

        line = index;
    }

    return { line, character: offset - offsets[line] };
}

export function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}
