import type { SortMode } from '../types';

export interface SaveHookOptions {
    autoImportOnSave: boolean;
    removeOnSave: boolean;
    sortOnSave: boolean;
    sortMode: SortMode;
    ignoredClasses: string[];
}

export interface SaveHookProcessors {
    autoImportText: (text: string) => string;
    removeUnusedText: (text: string, ignoredClasses: string[]) => string;
    sortText: (text: string, mode: SortMode) => string;
}

export function computeSaveHookText(
    originalText: string,
    options: SaveHookOptions,
    processors: SaveHookProcessors
): string {
    let text = originalText;

    if (options.autoImportOnSave) {
        text = processors.autoImportText(text);
    }

    if (options.removeOnSave) {
        text = processors.removeUnusedText(text, options.ignoredClasses);
    }

    if (options.sortOnSave) {
        try {
            text = processors.sortText(text, options.sortMode);
        } catch {
            return text;
        }
    }

    return text;
}
