import * as vscode from 'vscode';
import { NamespaceIndex } from './NamespaceIndex';
import type { CacheEntry, ResolvedNamespace } from '../types';
import { getConfig } from '../utils/config';

export class NamespaceCache implements vscode.Disposable {
    private readonly index = new NamespaceIndex();
    private watcher: vscode.FileSystemWatcher | null = null;
    private readonly updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly onDidUpdateEmitter = new vscode.EventEmitter<void>();

    public readonly onDidUpdate = this.onDidUpdateEmitter.event;

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

        this.onDidUpdateEmitter.fire();
    }

    public async initialize(): Promise<void> {
        await this.rebuild();

        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.php');
        this.watcher.onDidCreate((uri) => this.scheduleIndexFile(uri));
        this.watcher.onDidChange((uri) => this.scheduleIndexFile(uri));
        this.watcher.onDidDelete((uri) => {
            this.index.removeFile(uri);
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
            void this.indexFile(uri).then(() => this.onDidUpdateEmitter.fire());
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
}
