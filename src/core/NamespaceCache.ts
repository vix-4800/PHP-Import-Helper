import * as vscode from 'vscode';
import type { PerformanceMonitor } from '../features/PerformanceMonitor';
import type {
    CacheActivityEvent,
    CacheActivityPhase,
    CacheEntry,
    IndexStats,
    ResolvedNamespace,
} from '../types';
import { indexExcludePatterns } from '../utils/config';
import {
    buildIndexExcludeGlob,
    isWithinRoots,
    shouldIncludePhpFile,
} from '../utils/indexExcludes';
import { NamespaceCacheUpdateQueue } from './NamespaceCacheUpdateQueue';
import { NamespaceIndex } from './NamespaceIndex';

export class NamespaceCache implements vscode.Disposable {
    private static readonly indexVersion = 1;
    private static readonly indexFileName = 'namespace-index.json';
    private static readonly fileBatchSize = 64;
    private static readonly statBatchSize = 256;
    private static readonly updateDebounceMs = 1000;

    private readonly index = new NamespaceIndex();
    private readonly fileIndex = new Map<
        string,
        { mtime: number; entries: Array<{ className: string; fqcn: string }> }
    >();
    private watcher: vscode.FileSystemWatcher | null = null;
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly updateQueue: NamespaceCacheUpdateQueue<vscode.Uri>;
    private readonly onDidUpdateEmitter = new vscode.EventEmitter<void>();
    private readonly onDidChangeActivityEmitter = new vscode.EventEmitter<CacheActivityEvent>();
    private initializePromise: Promise<void> | null = null;
    private updateActivityActive = false;
    private processingUpdate = false;
    private lastRebuildDurationMs: number | null = null;

    public readonly onDidUpdate = this.onDidUpdateEmitter.event;
    public readonly onDidChangeActivity = this.onDidChangeActivityEmitter.event;

    public constructor(
        private readonly storageUri?: vscode.Uri,
        private readonly performance?: PerformanceMonitor
    ) {
        this.updateQueue = new NamespaceCacheUpdateQueue((uri) => this.shouldIndexWatchedUri(uri));
    }

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
        if (this.initializePromise !== null) {
            await this.initializePromise;
        }

        const startedAt = Date.now();
        await this.runActivity('rebuild', async () => {
            await this.rebuildNow(fixtures);
        });
        const durationMs = Date.now() - startedAt;

        this.lastRebuildDurationMs = durationMs;
        this.performance?.recordRebuildDuration(durationMs);
    }

    public async initialize(): Promise<void> {
        this.initializePromise ??= this.runActivity('initialize', async () => {
            await this.initializeNow();
        });

        await this.initializePromise;
    }

    private async rebuildNow(fixtures?: CacheEntry[]): Promise<void> {
        if (fixtures !== undefined) {
            this.setEntries(fixtures);
            await this.persistIndex();
            this.onDidUpdateEmitter.fire();
            return;
        }

        this.index.clear();
        this.fileIndex.clear();
        const files = await this.findIndexedPhpFiles();

        await this.indexFiles(files);

        await this.persistIndex();
        this.onDidUpdateEmitter.fire();
    }

    private async initializeNow(): Promise<void> {
        const loaded = await this.loadPersistedIndex();

        if (!loaded) {
            await this.rebuildNow();
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
        this.watcher.onDidDelete((uri) => this.scheduleRemoveFile(uri));
    }

    public dispose(): void {
        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = null;

        this.watcher?.dispose();
        this.onDidUpdateEmitter.dispose();
        this.onDidChangeActivityEmitter.dispose();
    }

    public indexStats(): IndexStats {
        let indexedClasses = 0;
        for (const file of this.fileIndex.values()) {
            indexedClasses += file.entries.length;
        }

        return {
            indexedFiles: this.fileIndex.size,
            indexedClasses,
        };
    }

    private scheduleIndexFile(uri: vscode.Uri): void {
        this.performance?.recordWatcherEvent({
            ignored: !this.shouldIndexWatchedUri(uri),
        });
        if (!this.updateQueue.addChanged(uri)) {
            return;
        }

        this.scheduleQueuedUpdate();
    }

    private scheduleRemoveFile(uri: vscode.Uri): void {
        this.performance?.recordWatcherEvent({
            ignored: !this.shouldIndexWatchedUri(uri),
        });
        if (!this.updateQueue.addDeleted(uri)) {
            return;
        }

        this.scheduleQueuedUpdate();
    }

    private scheduleQueuedUpdate(): void {
        if (!this.updateActivityActive) {
            this.updateActivityActive = true;
            this.onDidChangeActivityEmitter.fire({ kind: 'start', phase: 'update' });
        }

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }

        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            void this.processQueuedUpdate();
        }, NamespaceCache.updateDebounceMs);
    }

    private async processQueuedUpdate(): Promise<void> {
        if (this.processingUpdate) {
            return;
        }

        const startedAt = Date.now();
        this.processingUpdate = true;
        let changed = false;
        let changedCount = 0;
        let deletedCount = 0;
        let readMs = 0;
        let parseMs = 0;
        let persistMs = 0;

        try {
            while (this.updateQueue.size > 0) {
                const batch = this.updateQueue.consume();
                changedCount += batch.changed.length;
                deletedCount += batch.deleted.length;

                for (const uri of batch.deleted) {
                    this.removeFile(uri);
                }

                const metrics = await this.indexFiles(batch.changed);
                readMs += metrics.readMs;
                parseMs += metrics.parseMs;
                changed = changed || batch.changed.length > 0 || batch.deleted.length > 0;
            }

            if (changed) {
                const persistStartedAt = Date.now();
                await this.persistIndex();
                persistMs += Date.now() - persistStartedAt;
                this.onDidUpdateEmitter.fire();
            }
        } finally {
            this.processingUpdate = false;

            if (changed) {
                this.performance?.recordIndexBatch({
                    changed: changedCount,
                    deleted: deletedCount,
                    readMs,
                    parseMs,
                    persistMs,
                    durationMs: Date.now() - startedAt,
                    trace: vscode.workspace.getConfiguration('phpImportHelper').get<boolean>('performance.trace', false),
                });
            }

            if (this.updateQueue.size > 0) {
                this.scheduleQueuedUpdate();
                return;
            }

            if (this.updateActivityActive) {
                this.updateActivityActive = false;
                this.onDidChangeActivityEmitter.fire({ kind: 'end', phase: 'update' });
            }
        }
    }

    private async runActivity<T>(
        phase: CacheActivityPhase,
        operation: () => Promise<T>
    ): Promise<T> {
        this.onDidChangeActivityEmitter.fire({ kind: 'start', phase });

        try {
            return await operation();
        } finally {
            this.onDidChangeActivityEmitter.fire({ kind: 'end', phase });
        }
    }

    private async indexFile(uri: vscode.Uri): Promise<{ readMs: number; parseMs: number }> {
        try {
            const readStartedAt = Date.now();
            const [raw, stat] = await Promise.all([
                vscode.workspace.fs.readFile(uri),
                vscode.workspace.fs.stat(uri),
            ]);
            const readMs = Date.now() - readStartedAt;
            const text = Buffer.from(raw).toString('utf8');
            const parseStartedAt = Date.now();
            const entries = NamespaceIndex.entriesFromPhpFile(uri, text);
            const parseMs = Date.now() - parseStartedAt;

            this.index.replaceFile(uri, entries as CacheEntry[]);
            this.fileIndex.set(uri.toString(), {
                mtime: stat.mtime,
                entries: entries.map((entry) => ({
                    className: entry.className,
                    fqcn: entry.fqcn,
                })),
            });

            return { readMs, parseMs };
        } catch {
            this.removeFile(uri);
            return { readMs: 0, parseMs: 0 };
        }
    }

    private removeFile(uri: vscode.Uri): void {
        this.index.removeFile(uri);
        this.fileIndex.delete(uri.toString());
    }

    private async indexFiles(uris: vscode.Uri[]): Promise<{ readMs: number; parseMs: number }> {
        const results = await this.mapInBatches(uris, NamespaceCache.fileBatchSize, async (uri) => {
            return await this.indexFile(uri);
        });

        return results.reduce(
            (totals, item) => ({
                readMs: totals.readMs + item.readMs,
                parseMs: totals.parseMs + item.parseMs,
            }),
            { readMs: 0, parseMs: 0 }
        );
    }

    private async incrementalUpdate(): Promise<boolean> {
        const files = await this.findIndexedPhpFiles();
        const candidates = new Map<string, vscode.Uri>();
        const seen = new Set<string>();
        let changed = false;

        for (const uri of files) {
            candidates.set(uri.toString(), uri);
        }

        for (const uriString of this.fileIndex.keys()) {
            const uri = vscode.Uri.parse(uriString);
            if (this.shouldRefreshPersistedFile(uri)) {
                candidates.set(uriString, uri);
            }
        }

        const toIndex = await this.mapInBatches([...candidates.values()], NamespaceCache.statBatchSize, async (uri) => {
            const uriString = uri.toString();
            seen.add(uriString);
            const existing = this.fileIndex.get(uriString);

            if (existing === undefined) {
                return uri;
            }

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (existing.mtime <= 0 || stat.mtime !== existing.mtime) {
                    return uri;
                }
            } catch {
                this.removeFile(uri);
                changed = true;
            }

            return null;
        });

        const changedFiles = toIndex.filter((uri): uri is vscode.Uri => uri !== null);
        if (changedFiles.length > 0) {
            await this.indexFiles(changedFiles);
            changed = true;
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

    private async findIndexedPhpFiles(): Promise<vscode.Uri[]> {
        const coarseExclude = buildIndexExcludeGlob(indexExcludePatterns());
        const files = await vscode.workspace.findFiles('**/*.php', coarseExclude);

        return files.filter((uri) => this.shouldIndexWatchedUri(uri));
    }

    private async mapInBatches<T, TResult>(
        items: T[],
        batchSize: number,
        operation: (item: T) => Promise<TResult>
    ): Promise<TResult[]> {
        const results: TResult[] = [];

        for (let index = 0; index < items.length; index += batchSize) {
            const batch = items.slice(index, index + batchSize);
            results.push(...await Promise.all(batch.map(operation)));
        }

        return results;
    }

    private isInWorkspace(uri: vscode.Uri): boolean {
        return isWithinRoots(uri.fsPath, this.projectRoots());
    }

    private shouldIndexWatchedUri(uri: vscode.Uri): boolean {
        return uri.scheme === 'file' &&
            shouldIncludePhpFile(uri.fsPath, this.projectRoots(), indexExcludePatterns(uri));
    }

    private shouldRefreshPersistedFile(uri: vscode.Uri): boolean {
        if (uri.scheme !== 'file' || !uri.fsPath.endsWith('.php')) {
            return false;
        }

        return shouldIncludePhpFile(uri.fsPath, this.projectRoots(), indexExcludePatterns(uri));
    }

    private projectRoots(): string[] {
        const roots = new Set(
            (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
        );

        roots.add(process.cwd());

        return [...roots];
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
        const encoded = Buffer.from(JSON.stringify({
            version: NamespaceCache.indexVersion,
            files,
        }), 'utf8');
        const startedAt = Date.now();
        await vscode.workspace.fs.createDirectory(this.storageUri);
        await vscode.workspace.fs.writeFile(indexUri, encoded);
        this.performance?.recordCachePersist({
            files: this.fileIndex.size,
            bytes: encoded.byteLength,
            ms: Date.now() - startedAt,
            trace: vscode.workspace.getConfiguration('phpImportHelper').get<boolean>('performance.trace', false),
        });
    }
}
