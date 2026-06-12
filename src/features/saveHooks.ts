import type { SortMode } from '../types';

export interface SaveHookOptions {
    autoImportOnSave: boolean;
    removeOnSave: boolean;
    sortOnSave: boolean;
    sortMode: SortMode;
    ignoredClasses: string[];
}

export interface SaveHookProcessors {
    autoImportText: (text: string) => Promise<string>;
    removeUnusedText: (text: string, ignoredClasses: string[]) => string;
    sortText: (text: string, mode: SortMode) => string;
}

export async function computeSaveHookText(
    originalText: string,
    options: SaveHookOptions,
    processors: SaveHookProcessors
): Promise<string> {
    let text = originalText;

    if (options.autoImportOnSave) {
        text = await processors.autoImportText(text);
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
