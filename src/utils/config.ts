import * as vscode from 'vscode';
import type { ImportAllOptions } from '../core/importAllText';
import type { SortMode } from '../types';
import {
    defaultIndexExcludePatterns,
    defaultResolveExcludePatterns,
} from './indexExcludes';

export function getConfig(resource?: vscode.Uri): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('phpImportHelper', resource);
}

export function sortMode(resource?: vscode.Uri): SortMode {
    return getConfig(resource).get<SortMode>('sortMode', 'natural');
}

export function leadingSeparator(resource?: vscode.Uri): boolean {
    return getConfig(resource).get<boolean>('leadingSeparator', true);
}

export function ignoredClasses(resource?: vscode.Uri): string[] {
    return getConfig(resource).get<string[]>('ignoreList', []);
}

export function removeDuplicateImports(resource?: vscode.Uri): boolean {
    return getConfig(resource).get<boolean>('removeDuplicateImports', false);
}

export function importAllOptions(resource?: vscode.Uri): ImportAllOptions {
    const config = getConfig(resource);

    return {
        autoAliasConflicts: config.get<boolean>('autoAliasConflicts', false),
        aliasPrefixes: config.get<string[]>('autoAliasPrefixes', ['Base', 'Core']),
    };
}

export function indexExcludePatterns(resource?: vscode.Uri): string[] {
    return getConfig(resource).get<string[]>('index.exclude', defaultIndexExcludePatterns);
}

export function resolveExcludePatterns(resource?: vscode.Uri): string[] {
    return getConfig(resource).get<string[]>('resolve.exclude', defaultResolveExcludePatterns);
}
