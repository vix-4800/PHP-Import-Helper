import type { ImportKind } from '../types';

declare function require(name: string): unknown;

export interface PhpAstPosition {
    line: number;
    column: number;
    offset: number;
}

export interface PhpAstLocation {
    source: string | null;
    start: PhpAstPosition;
    end: PhpAstPosition;
}

export interface PhpAstComment {
    kind: string;
    value: string;
    loc?: PhpAstLocation;
    offset?: number;
}

export interface PhpAstNode {
    kind: string;
    loc?: PhpAstLocation;
    leadingComments?: PhpAstComment[];
    [key: string]: unknown;
}

export interface PhpAstProgram extends PhpAstNode {
    kind: 'program';
    children: PhpAstNode[];
    errors?: PhpAstParseError[];
}

export interface PhpAstIdentifier extends PhpAstNode {
    kind: 'identifier';
    name: string;
}

export interface PhpAstName extends PhpAstNode {
    kind: 'name';
    name: string;
    resolution?: string;
}

export interface PhpAstNamespace extends PhpAstNode {
    kind: 'namespace';
    name: string | null;
    withBrackets?: boolean;
    children: PhpAstNode[];
}

export interface PhpAstUseItem extends PhpAstNode {
    kind: 'useitem';
    name: string;
    alias: PhpAstIdentifier | null;
    type: ImportKind | null;
}

export interface PhpAstUseGroup extends PhpAstNode {
    kind: 'usegroup';
    name: string | null;
    type: ImportKind | null;
    items: PhpAstUseItem[];
}

export interface PhpAstParseError {
    message: string;
    line?: number;
    token?: string;
}

export interface PhpAstDocument {
    text: string;
    filename: string;
    program: PhpAstProgram;
    errors: PhpAstParseError[];
}

type RawProgram = PhpAstProgram & {
    errors?: Array<{ message?: string; line?: number; token?: string }>;
};

export class PhpAstParser {
    private readonly engine: { parseCode: (code: string, filename?: string) => unknown };

    public constructor() {
        const Parser = require('php-parser') as {
            Engine: new (options: unknown) => {
                parseCode: (code: string, filename?: string) => unknown;
            };
        };

        this.engine = new Parser.Engine({
            parser: { extractDoc: true, suppressErrors: true, version: 804 },
            ast: { withPositions: true },
        });
    }

    public parse(code: string, filename = 'document.php'): PhpAstDocument {
        try {
            const parsed = this.engine.parseCode(code, filename);
            const program = this.asProgram(parsed);

            return {
                text: code,
                filename,
                program,
                errors: this.normalizeErrors(program.errors),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown parse error';

            return {
                text: code,
                filename,
                program: {
                    kind: 'program',
                    children: [],
                },
                errors: [{ message }],
            };
        }
    }

    public getNamespace(document: PhpAstDocument): PhpAstNamespace | null {
        const namespace = document.program.children.find((node) => node.kind === 'namespace');

        return namespace === undefined ? null : (namespace as PhpAstNamespace);
    }

    public getTopLevelStatements(document: PhpAstDocument): PhpAstNode[] {
        return this.getNamespace(document)?.children ?? document.program.children;
    }

    public getNodeText(document: PhpAstDocument, node: PhpAstNode): string {
        const start = node.loc?.start.offset;
        const end = node.loc?.end.offset;

        return start === undefined || end === undefined ? '' : document.text.slice(start, end);
    }

    public walk(
        node: PhpAstNode | null | undefined,
        visitor: (node: PhpAstNode, parent: PhpAstNode | null, key: number | string | null) => void
    ): void {
        const visit = (
            current: unknown,
            parent: PhpAstNode | null,
            key: number | string | null
        ): void => {
            if (!this.isNode(current)) {
                return;
            }

            visitor(current, parent, key);

            for (const [childKey, value] of Object.entries(current)) {
                if (childKey === 'loc') {
                    continue;
                }

                if (Array.isArray(value)) {
                    value.forEach((item, index) => visit(item, current, `${childKey}:${index}`));
                    continue;
                }

                visit(value, current, childKey);
            }
        };

        visit(node, null, null);
    }

    public isName(node: unknown): node is PhpAstName {
        return this.isNode(node) && node.kind === 'name' && typeof node.name === 'string';
    }

    public isUseGroup(node: unknown): node is PhpAstUseGroup {
        return (
            this.isNode(node) &&
            node.kind === 'usegroup' &&
            Array.isArray(node.items)
        );
    }

    private asProgram(value: unknown): PhpAstProgram {
        if (this.isNode(value) && value.kind === 'program') {
            const program = value as RawProgram;
            return {
                ...program,
                children: Array.isArray(program.children) ? program.children : [],
            };
        }

        return {
            kind: 'program',
            children: [],
        };
    }

    private normalizeErrors(errors: RawProgram['errors']): PhpAstParseError[] {
        return (errors ?? []).map((error) => ({
            message: error.message ?? 'Unknown parse error',
            line: error.line,
            token: error.token,
        }));
    }

    private isNode(value: unknown): value is PhpAstNode {
        return (
            typeof value === 'object' &&
            value !== null &&
            'kind' in value &&
            typeof (value as { kind: unknown }).kind === 'string'
        );
    }
}
