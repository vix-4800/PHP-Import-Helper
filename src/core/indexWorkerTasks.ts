import { NamespaceIndex } from './NamespaceIndex';

export interface SerializableIndexEntry {
    className: string;
    fqcn: string;
}

export interface ParsePhpFileInput {
    uri: string;
    fsPath: string;
    text: string;
}

export interface ParsePhpFileResult {
    uri: string;
    entries: SerializableIndexEntry[];
}

export interface PersistedIndexFile {
    mtime: number;
    entries: SerializableIndexEntry[];
}

export interface PersistedIndexData {
    version: number;
    files: Record<string, PersistedIndexFile>;
}

export function parsePhpFiles(files: readonly ParsePhpFileInput[]): ParsePhpFileResult[] {
    return files.map((file) => ({
        uri: file.uri,
        entries: NamespaceIndex.entriesFromPhpFile(
            { fsPath: file.fsPath },
            file.text
        ).map((entry) => ({
            className: entry.className,
            fqcn: entry.fqcn,
        })),
    }));
}

export function encodePersistedIndex(value: PersistedIndexData): string {
    return JSON.stringify(value);
}

export function decodePersistedIndex(text: string): PersistedIndexData {
    return JSON.parse(text) as PersistedIndexData;
}
