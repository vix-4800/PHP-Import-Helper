import type * as vscode from 'vscode';

export type ImportKind = 'class' | 'function' | 'const';
export type SortMode = 'natural' | 'length' | 'alphabetical';

export interface DeclarationLines {
    phpTag: number;
    declare: number | null;
    namespace: number | null;
    firstUseStatement: number | null;
    lastUseStatement: number | null;
    classDeclaration: number | null;
}

export interface UseStatement {
    text: string;
    line: number;
    endLine: number;
    fqcn: string;
    alias: string | null;
    className: string;
    kind: ImportKind;
}

export interface ParseResult {
    namespace: string | null;
    declarationLines: DeclarationLines;
    useStatements: UseStatement[];
    declaredClassNames: string[];
}

export interface DetectedClass {
    name: string;
    line: number;
    character: number;
}

export interface ResolvedNamespace {
    fqcn: string;
    source: 'project' | 'vendor' | 'global';
    uri?: vscode.Uri;
}

export interface CacheEntry {
    fqcn: string;
    className: string;
    uri: vscode.Uri;
}

export enum DiagnosticCode {
    ClassNotImported = 'phpImportHelper.classNotImported',
    ClassNotUsed = 'phpImportHelper.classNotUsed',
}

export interface InsertPosition {
    line: number;
    prepend: string;
    append: string;
}
