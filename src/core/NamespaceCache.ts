import * as vscode from 'vscode';
import { NamespaceIndex } from './NamespaceIndex';
import type { CacheEntry, ResolvedNamespace } from '../types';
import { getConfig } from '../utils/config';

export class NamespaceCache implements vscode.Disposable {
    private static readonly indexVersion = 1;
    private static readonly indexFileName = 'namespace-index.json';

    private readonly index = new NamespaceIndex();
    private watcher: vscode.FileSystemWatcher | null = null;
    private readonly updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly onDidUpdateEmitter = new vscode.EventEmitter<void>();

    public readonly onDidUpdate = this.onDidUpdateEmitter.event;

    public constructor(private readonly storageUri?: vscode.Uri) {}

    public setEntries(entries: CacheEntry[]): void {
        this.index.setEntries(entries);
    }

    public add(entry: CacheEntry): void {
        this.index.add(entry);
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
            this.onDidUpdateEmitter.fire();
        }

        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.php');
        this.watcher.onDidCreate((uri) => this.scheduleIndexFile(uri));
        this.watcher.onDidChange((uri) => this.scheduleIndexFile(uri));
        this.watcher.onDidDelete((uri) => {
            this.index.removeFile(uri);
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
            const raw = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(raw).toString('utf8');
            const entries = NamespaceIndex.entriesFromPhpFile(uri, text);

            this.index.replaceFile(uri, entries as CacheEntry[]);
        } catch {
            this.index.removeFile(uri);
        }
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
                files?: Record<string, { entries?: Array<{ className?: string; fqcn?: string }> }>;
            };

            if (parsed.version !== NamespaceCache.indexVersion || parsed.files === undefined) {
                return false;
            }

            const entries: CacheEntry[] = [];
            for (const [uriString, file] of Object.entries(parsed.files)) {
                const uri = vscode.Uri.parse(uriString);

                for (const entry of file.entries ?? []) {
                    if (typeof entry.className !== 'string' || typeof entry.fqcn !== 'string') {
                        continue;
                    }

                    entries.push({
                        className: entry.className,
                        fqcn: entry.fqcn,
                        uri,
                    });
                }
            }

            this.setEntries(entries);

            return true;
        } catch {
            return false;
        }
    }

    private async persistIndex(): Promise<void> {
        if (this.storageUri === undefined) {
            return;
        }

        const files: Record<string, { entries: Array<{ className: string; fqcn: string }> }> = {};

        for (const entry of this.index.toEntries()) {
            const uri = entry.uri as vscode.Uri;
            const uriString = uri.toString();
            files[uriString] ??= { entries: [] };
            files[uriString].entries.push({
                className: entry.className,
                fqcn: entry.fqcn,
            });
        }

        const indexUri = vscode.Uri.joinPath(this.storageUri, NamespaceCache.indexFileName);
        await vscode.workspace.fs.createDirectory(this.storageUri);
        await vscode.workspace.fs.writeFile(indexUri, Buffer.from(JSON.stringify({
            version: NamespaceCache.indexVersion,
            files,
        }), 'utf8'));
    }
}
