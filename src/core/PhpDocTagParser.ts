export interface PhpDocTag {
    tag: string;
    body: string;
    index: number;
}

export interface PhpDocBlock {
    text: string;
    index: number;
}

const supportedTags = new Set([
    'param',
    'return',
    'var',
    'throws',
    'property',
    'property-read',
    'property-write',
    'mixin',
    'extends',
    'implements',
    'method',
    'see',
    'template',
    'phpstan-type',
]);

interface PhpDocLine {
    content: string;
    offset: number;
}

function isWhitespace(char: string | undefined): boolean {
    return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function isTagNameChar(char: string | undefined): boolean {
    return char !== undefined && (
        (char >= 'a' && char <= 'z') ||
        (char >= 'A' && char <= 'Z') ||
        char === '-'
    );
}

function trimRightCommentEnd(line: PhpDocLine): PhpDocLine {
    let end = line.content.length;

    while (end > 0 && isWhitespace(line.content[end - 1])) {
        end--;
    }

    if (end >= 2 && line.content[end - 2] === '*' && line.content[end - 1] === '/') {
        end -= 2;
        while (end > 0 && isWhitespace(line.content[end - 1])) {
            end--;
        }
    }

    return {
        content: line.content.slice(0, end),
        offset: line.offset,
    };
}

function normalizePhpDocLine(rawLine: string, lineOffset: number): PhpDocLine {
    let index = 0;

    while (isWhitespace(rawLine[index])) {
        index++;
    }

    if (rawLine[index] === '/' && rawLine[index + 1] === '*') {
        index += 2;
        while (rawLine[index] === '*') {
            index++;
        }
    } else if (rawLine[index] === '*') {
        while (rawLine[index] === '*') {
            index++;
        }
    }

    while (isWhitespace(rawLine[index])) {
        index++;
    }

    return trimRightCommentEnd({
        content: rawLine.slice(index),
        offset: lineOffset + index,
    });
}

function phpDocLines(text: string): PhpDocLine[] {
    const lines: PhpDocLine[] = [];
    let lineStart = 0;

    for (let index = 0; index <= text.length; index++) {
        if (index !== text.length && text[index] !== '\n') {
            continue;
        }

        const lineEnd = index > lineStart && text[index - 1] === '\r' ? index - 1 : index;
        lines.push(normalizePhpDocLine(text.slice(lineStart, lineEnd), lineStart));
        lineStart = index + 1;
    }

    return lines;
}

function tagAt(line: PhpDocLine): { tag: string; body: string; index: number } | null {
    if (!line.content.startsWith('@')) {
        return null;
    }

    let index = 1;
    while (isTagNameChar(line.content[index])) {
        index++;
    }

    const tag = line.content.slice(1, index);
    if (!supportedTags.has(tag)) {
        return null;
    }

    while (isWhitespace(line.content[index])) {
        index++;
    }

    return {
        tag,
        body: line.content.slice(index),
        index: line.offset,
    };
}

export function parsePhpDocTags(text: string): PhpDocTag[] {
    const tags: PhpDocTag[] = [];
    let current: PhpDocTag | null = null;

    for (const line of phpDocLines(text)) {
        const tag = tagAt(line);
        if (tag !== null) {
            current = tag;
            tags.push(current);
            continue;
        }

        if (line.content.startsWith('@')) {
            current = null;
            continue;
        }

        if (current === null || line.content === '') {
            continue;
        }

        current.body = `${current.body} ${line.content.trim()}`.trim();
    }

    return tags;
}

export function parsePhpDocBlocks(text: string): PhpDocBlock[] {
    const blocks: PhpDocBlock[] = [];
    let index = 0;

    while (index < text.length) {
        if (text[index] !== '/' || text[index + 1] !== '*' || text[index + 2] !== '*') {
            index++;
            continue;
        }

        const start = index;
        index += 3;

        while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
            index++;
        }

        index = Math.min(index + 2, text.length);
        blocks.push({
            text: text.slice(start, index),
            index: start,
        });
    }

    return blocks;
}
