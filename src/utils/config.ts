import * as vscode from 'vscode';
import type { SortMode } from '../types';
import { defaultIndexExcludePatterns } from './indexExcludes';

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

export function indexExcludePatterns(resource?: vscode.Uri): string[] {
    return getConfig(resource).get<string[]>('index.exclude', defaultIndexExcludePatterns);
}
