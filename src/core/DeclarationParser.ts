import type { DeclarationLines, ImportKind, ParseResult, UseStatement } from '../types';
import { getInsertPosition } from './insertPosition';
import {
    PhpAstParser,
    type PhpAstNode,
    type PhpAstUseGroup,
    type PhpAstUseItem,
} from './phpParser';

function isClassLike(node: PhpAstNode): boolean {
    return ['class', 'interface', 'trait', 'enum'].includes(node.kind);
}

function normalizeImportKind(kind: ImportKind | null): ImportKind {
    return kind ?? 'class';
}

function shortName(fqcn: string): string {
    return fqcn.split('\\').pop() ?? fqcn;
}

function phpTagLine(text: string): number {
    const index = text.indexOf('<?php');

    if (index === -1) {
        return 0;
    }

    return text.slice(0, index).split(/\r?\n/).length;
}

export class DeclarationParser {
    public constructor(private readonly phpParser = new PhpAstParser()) {}

    public parse(text: string, ensureNotImported?: string): ParseResult {
        const document = this.phpParser.parse(text);
        const namespaceNode = this.phpParser.getNamespace(document);
        const topLevelStatements = this.phpParser.getTopLevelStatements(document);
        const declarationLines: DeclarationLines = {
            phpTag: phpTagLine(text),
            declare: null,
            namespace: namespaceNode?.loc?.start.line ?? null,
            firstUseStatement: null,
            lastUseStatement: null,
            classDeclaration: null,
        };
        const useStatements: UseStatement[] = [];
        const declaredClassNames: string[] = [];
        const namespace = namespaceNode?.name ?? null;
        let beforeDeclaration = true;

        for (const statement of document.program.children) {
            if (statement.kind === 'declare') {
                declarationLines.declare ??= statement.loc?.start.line ?? null;
            }
        }

        for (const statement of topLevelStatements) {
            if (isClassLike(statement)) {
                const name = this.readDeclaredClassName(statement);
                if (name !== null) {
                    declaredClassNames.push(name);
                }

                declarationLines.classDeclaration ??= statement.loc?.start.line ?? null;
                beforeDeclaration = false;
                continue;
            }

            if (!beforeDeclaration || !this.phpParser.isUseGroup(statement)) {
                continue;
            }

            const parsed = this.parseUseGroup(document.text, statement);
            if (parsed.length === 0) {
                continue;
            }

            declarationLines.firstUseStatement ??= statement.loc?.start.line ?? null;
            declarationLines.lastUseStatement = statement.loc?.end.line ?? null;
            useStatements.push(...parsed);
        }

        const normalizedEnsureNotImported = ensureNotImported?.replace(/^\\+/, '');
        if (
            normalizedEnsureNotImported !== undefined &&
            useStatements.some((statement) => statement.fqcn === normalizedEnsureNotImported)
        ) {
            throw new Error(`${ensureNotImported} is already imported`);
        }

        return {
            namespace,
            declarationLines,
            useStatements,
            declaredClassNames,
        };
    }

    public getImportedClassNames(text: string): string[] {
        return this.parse(text)
            .useStatements.filter((statement) => statement.kind === 'class')
            .map((statement) => statement.className);
    }

    public getDeclaredClassNames(text: string): string[] {
        return this.parse(text).declaredClassNames;
    }

    public getImportedClassName(text: string, fqcn: string): string | null {
        const normalized = fqcn.replace(/^\\+/, '');
        const statement = this.parse(text).useStatements.find((item) => item.fqcn === normalized);

        return statement?.className ?? null;
    }

    public getInsertPosition(declarationLines: DeclarationLines) {
        return getInsertPosition(declarationLines);
    }

    private parseUseGroup(text: string, statement: PhpAstUseGroup): UseStatement[] {
        const line = statement.loc?.start.line;
        const endLine = statement.loc?.end.line;

        if (line === undefined || endLine === undefined) {
            return [];
        }

        const groupText = statement.loc === undefined ? '' : text.slice(statement.loc.start.offset, statement.loc.end.offset);

        return statement.items
            .map((item) => this.parseUseItem(groupText, statement, item, line, endLine))
            .filter((item): item is UseStatement => item !== null);
    }

    private parseUseItem(
        text: string,
        group: PhpAstUseGroup,
        item: PhpAstUseItem,
        line: number,
        endLine: number
    ): UseStatement | null {
        const prefix = group.name === null ? '' : `${group.name.replace(/\\+$/, '')}\\`;
        const fqcn = `${prefix}${item.name}`.replace(/^\\+|\\+$/g, '');

        if (fqcn === '') {
            return null;
        }

        const alias = item.alias?.name ?? null;
        const kind = normalizeImportKind(item.type ?? group.type);

        return {
            text,
            line,
            endLine,
            fqcn,
            alias,
            className: alias ?? shortName(fqcn),
            kind,
        };
    }

    private readDeclaredClassName(node: PhpAstNode): string | null {
        const name = node.name;

        if (
            typeof name === 'object' &&
            name !== null &&
            'name' in name &&
            typeof (name as { name: unknown }).name === 'string' &&
            (name as { name: string }).name !== ''
        ) {
            return (name as { name: string }).name;
        }

        return null;
    }
}
