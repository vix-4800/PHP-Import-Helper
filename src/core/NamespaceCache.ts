import * as vscode from 'vscode';
import { NamespaceIndex } from './NamespaceIndex';
import type { CacheEntry, ResolvedNamespace } from '../types';
import { getConfig } from '../utils/config';

export class NamespaceCache implements vscode.Disposable {
    private static readonly indexVersion = 1;
    private static readonly indexFileName = 'namespace-index.json';

    private readonly index = new NamespaceIndex();
    private readonly fileIndex = new Map<
        string,
        { mtime: number; entries: Array<{ className: string; fqcn: string }> }
    >();
    private watcher: vscode.FileSystemWatcher | null = null;
    private readonly updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly onDidUpdateEmitter = new vscode.EventEmitter<void>();

    public readonly onDidUpdate = this.onDidUpdateEmitter.event;

    public constructor(private readonly storageUri?: vscode.Uri) {}

    public setEntries(entries: CacheEntry[]): void {
        this.index.setEntries(entries);
        this.fileIndex.clear();

        for (const entry of entries) {
            const uriString = entry.uri.toString();
            const file = this.fileIndex.get(uriString) ?? { mtime: 0, entries: [] };
            file.entries.push({
                className: entry.className,
                fqcn: entry.fqcn,
            });
            this.fileIndex.set(uriString, file);
        }
    }

    public add(entry: CacheEntry): void {
        this.index.add(entry);
        const uriString = entry.uri.toString();
        const file = this.fileIndex.get(uriString) ?? { mtime: 0, entries: [] };
        file.entries.push({
            className: entry.className,
            fqcn: entry.fqcn,
        });
        this.fileIndex.set(uriString, file);
    }

    public lookup(className: string): CacheEntry[] {
        return this.index.lookup(className) as CacheEntry[];
    }

    public resolve(className: string): ResolvedNamespace[] {
        return this.index.resolve(className);
    }

    public async rebuild(fixtures?: CacheEntry[]): Promise<void> {
        if (fixtures !== undefined) {
            this.setEntries(fixtures);
            await this.persistIndex();
            this.onDidUpdateEmitter.fire();
            return;
        }

        this.index.clear();
        this.fileIndex.clear();

        const files = await vscode.workspace.findFiles(
            '**/*.php',
            getConfig().get<string>('exclude', '**/node_modules/**')
        );

        for (const uri of files) {
            await this.indexFile(uri);
        }

        await this.persistIndex();
        this.onDidUpdateEmitter.fire();
    }

    public async initialize(): Promise<void> {
        const loaded = await this.loadPersistedIndex();

        if (!loaded) {
            await this.rebuild();
        } else {
            const changed = await this.incrementalUpdate();
            if (changed) {
                await this.persistIndex();
            }
            this.onDidUpdateEmitter.fire();
        }

        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.php');
        this.watcher.onDidCreate((uri) => this.scheduleIndexFile(uri));
        this.watcher.onDidChange((uri) => this.scheduleIndexFile(uri));
        this.watcher.onDidDelete((uri) => {
            this.removeFile(uri);
            void this.persistIndex();
            this.onDidUpdateEmitter.fire();
        });
    }

    public dispose(): void {
        for (const timer of this.updateTimers.values()) {
            clearTimeout(timer);
        }
        this.updateTimers.clear();

        this.watcher?.dispose();
        this.onDidUpdateEmitter.dispose();
    }

    private scheduleIndexFile(uri: vscode.Uri): void {
        const key = uri.toString();
        const existingTimer = this.updateTimers.get(key);
        if (existingTimer !== undefined) {
            clearTimeout(existingTimer);
        }

        this.updateTimers.set(key, setTimeout(() => {
            this.updateTimers.delete(key);
            void this.indexFile(uri).then(async () => {
                await this.persistIndex();
                this.onDidUpdateEmitter.fire();
            });
        }, 250));
    }

    private async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const [raw, stat] = await Promise.all([
                vscode.workspace.fs.readFile(uri),
                vscode.workspace.fs.stat(uri),
            ]);
            const text = Buffer.from(raw).toString('utf8');
            const entries = NamespaceIndex.entriesFromPhpFile(uri, text);

            this.index.replaceFile(uri, entries as CacheEntry[]);
            this.fileIndex.set(uri.toString(), {
                mtime: stat.mtime,
                entries: entries.map((entry) => ({
                    className: entry.className,
                    fqcn: entry.fqcn,
                })),
            });
        } catch {
            this.removeFile(uri);
        }
    }

    private removeFile(uri: vscode.Uri): void {
        this.index.removeFile(uri);
        this.fileIndex.delete(uri.toString());
    }

    private async incrementalUpdate(): Promise<boolean> {
        const files = await vscode.workspace.findFiles(
            '**/*.php',
            getConfig().get<string>('exclude', '**/node_modules/**')
        );
        const seen = new Set<string>();
        let changed = false;

        for (const uri of files) {
            const uriString = uri.toString();
            seen.add(uriString);
            const existing = this.fileIndex.get(uriString);

            if (existing === undefined) {
                await this.indexFile(uri);
                changed = true;
                continue;
            }

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.mtime !== existing.mtime) {
                    await this.indexFile(uri);
                    changed = true;
                }
            } catch {
                this.removeFile(uri);
                changed = true;
            }
        }

        for (const uriString of [...this.fileIndex.keys()]) {
            const uri = vscode.Uri.parse(uriString);
            if (!seen.has(uriString) && this.isInWorkspace(uri)) {
                this.removeFile(uri);
                changed = true;
            }
        }

        return changed;
    }

    private isInWorkspace(uri: vscode.Uri): boolean {
        return vscode.workspace.workspaceFolders?.some((folder) =>
            uri.fsPath === folder.uri.fsPath ||
            uri.fsPath.startsWith(`${folder.uri.fsPath.replace(/\/$/, '')}/`)
        ) ?? false;
    }

    private async loadPersistedIndex(): Promise<boolean> {
        if (this.storageUri === undefined) {
            return false;
        }

        try {
            const indexUri = vscode.Uri.joinPath(
                this.storageUri,
                NamespaceCache.indexFileName
            );
            const raw = await vscode.workspace.fs.readFile(indexUri);
            const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as {
                version?: number;
                files?: Record<string, {
                    mtime?: number;
                    entries?: Array<{ className?: string; fqcn?: string }>;
                }>;
            };

            if (parsed.version !== NamespaceCache.indexVersion || parsed.files === undefined) {
                return false;
            }

            const entries: CacheEntry[] = [];
            const persistedFileIndex = new Map<
                string,
                { mtime: number; entries: Array<{ className: string; fqcn: string }> }
            >();
            for (const [uriString, file] of Object.entries(parsed.files)) {
                const uri = vscode.Uri.parse(uriString);
                const fileEntries: Array<{ className: string; fqcn: string }> = [];

                for (const entry of file.entries ?? []) {
                    if (typeof entry.className !== 'string' || typeof entry.fqcn !== 'string') {
                        continue;
                    }

                    entries.push({
                        className: entry.className,
                        fqcn: entry.fqcn,
                        uri,
                    });
                    fileEntries.push({
                        className: entry.className,
                        fqcn: entry.fqcn,
                    });
                }

                persistedFileIndex.set(uriString, {
                    mtime: typeof file.mtime === 'number' ? file.mtime : 0,
                    entries: fileEntries,
                });
            }

            this.setEntries(entries);
            this.fileIndex.clear();
            for (const [uriString, file] of persistedFileIndex) {
                this.fileIndex.set(uriString, file);
            }

            return true;
        } catch {
            return false;
        }
    }

    private async persistIndex(): Promise<void> {
        if (this.storageUri === undefined) {
            return;
        }

        const files: Record<string, {
            mtime: number;
            entries: Array<{ className: string; fqcn: string }>;
        }> = {};

        for (const [uriString, file] of this.fileIndex) {
            files[uriString] = {
                mtime: file.mtime,
                entries: file.entries,
            };
        }

        const indexUri = vscode.Uri.joinPath(this.storageUri, NamespaceCache.indexFileName);
        await vscode.workspace.fs.createDirectory(this.storageUri);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: NamespaceCache.indexVersion,
            files,
        }), 'utf8'));
    }
}
