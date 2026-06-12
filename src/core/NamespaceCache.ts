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
import {
    createIndexWorkerClient,
    type IndexWorkerClient,
} from './IndexWorkerClient';
import type {
    ParsePhpFileInput,
    ParsePhpFileResult,
    PersistedIndexData,
    SerializableIndexEntry,
} from './indexWorkerTasks';
import {
    decodePersistedIndex,
    encodePersistedIndex,
    parsePhpFiles,
} from './indexWorkerTasks';
import { NamespaceCacheUpdateQueue } from './NamespaceCacheUpdateQueue';
import { NamespaceIndex } from './NamespaceIndex';

interface FileIndexEntry {
    mtime: number;
    entries: SerializableIndexEntry[];
}

interface PreparedIndexFile {
    uri: vscode.Uri;
    raw: Uint8Array;
    mtime: number;
}

interface IndexSnapshot {
    index: NamespaceIndex;
    fileIndex: Map<string, FileIndexEntry>;
}

export class NamespaceCache implements vscode.Disposable {
    private static readonly indexVersion = 2;
    private static readonly indexFileName = 'namespace-index.json';
    private static readonly fileBatchSize = 64;
    private static readonly statBatchSize = 256;
    private static readonly updateDebounceMs = 1000;
    private static readonly persistDebounceMs = 3000;

    private readonly index = new NamespaceIndex();
    private readonly worker: IndexWorkerClient;
    private readonly ownsWorker: boolean;
    private readonly fileIndex = new Map<string, FileIndexEntry>();
    private watcher: vscode.FileSystemWatcher | null = null;
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly updateQueue: NamespaceCacheUpdateQueue<vscode.Uri>;
    private readonly onDidUpdateEmitter = new vscode.EventEmitter<void>();
    private readonly onDidChangeActivityEmitter = new vscode.EventEmitter<CacheActivityEvent>();
    private initializePromise: Promise<void> | null = null;
    private updateActivityActive = false;
    private processingUpdate = false;
    private rebuilding = false;
    private rebuildGeneration = 0;
    private lastRebuildDurationMs: number | null = null;

    public readonly onDidUpdate = this.onDidUpdateEmitter.event;
    public readonly onDidChangeActivity = this.onDidChangeActivityEmitter.event;

    public constructor(
        private readonly storageUri?: vscode.Uri,
        private readonly performance?: PerformanceMonitor,
        worker?: IndexWorkerClient
    ) {
        this.worker = worker ?? createIndexWorkerClient();
        this.ownsWorker = worker === undefined;
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
        const generation = ++this.rebuildGeneration;
        await this.runActivity('rebuild', async () => {
            await this.rebuildNow(fixtures, generation, 'immediate');
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

    private async rebuildNow(
        fixtures?: CacheEntry[],
        generation = ++this.rebuildGeneration,
        persistMode: 'debounced' | 'immediate' = 'debounced'
    ): Promise<void> {
        if (fixtures !== undefined) {
            this.setEntries(fixtures);
            await this.persistRebuiltIndex(persistMode);
            this.onDidUpdateEmitter.fire();
            return;
        }

        const files = await this.findIndexedPhpFiles();
        const snapshot = await this.buildSnapshot(files, this.fileIndex);

        if (generation !== this.rebuildGeneration) {
            return;
        }

        this.applySnapshot(snapshot);
        await this.persistRebuiltIndex(persistMode);
        this.onDidUpdateEmitter.fire();
    }

    private async initializeNow(): Promise<void> {
        this.createWatcher();
        const loaded = await this.loadPersistedIndex();

        if (loaded) {
            this.onDidUpdateEmitter.fire();
            setTimeout(() => {
                void this.reconcilePersistedIndexInBackground();
            }, 0);
            return;
        }

        setTimeout(() => {
            void this.reconcileInBackground();
        }, 0);
    }

    private createWatcher(): void {
        if (this.watcher !== null) {
            return;
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
        if (this.persistTimer !== null) {
            clearTimeout(this.persistTimer);
            void this.persistIndex();
        }
        this.updateTimer = null;
        this.persistTimer = null;

        this.watcher?.dispose();
        if (this.ownsWorker) {
            void this.worker.dispose();
        }
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
        if (this.processingUpdate || this.rebuilding) {
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
                this.schedulePersistIndex();
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

    private async readIndexFile(uri: vscode.Uri): Promise<PreparedIndexFile | null> {
        try {
            const [raw, stat] = await Promise.all([
                vscode.workspace.fs.readFile(uri),
                vscode.workspace.fs.stat(uri),
            ]);

            return { uri, raw, mtime: stat.mtime };
        } catch {
            return null;
        }
    }

    private removeFile(uri: vscode.Uri): void {
        this.index.removeFile(uri);
        this.fileIndex.delete(uri.toString());
    }

    private async indexFiles(uris: vscode.Uri[]): Promise<{ readMs: number; parseMs: number }> {
        const readStartedAt = Date.now();
        const readResults = await this.mapInBatches(
            uris,
            NamespaceCache.fileBatchSize,
            async (uri) => await this.readIndexFile(uri)
        );
        const readMs = Date.now() - readStartedAt;
        const prepared = readResults.filter((item): item is PreparedIndexFile => item !== null);
        const parseStartedAt = Date.now();
        const parsed = await this.parsePreparedFiles(prepared);
        const parseMs = Date.now() - parseStartedAt;

        this.applyParsedFiles(prepared, parsed, this.index, this.fileIndex);

        return { readMs, parseMs };
    }

    private async buildSnapshot(
        uris: vscode.Uri[],
        preservedFiles = new Map<string, FileIndexEntry>()
    ): Promise<IndexSnapshot> {
        const readResults = await this.mapInBatches(
            uris,
            NamespaceCache.fileBatchSize,
            async (uri) => await this.readIndexFile(uri)
        );
        const prepared = readResults.filter((item): item is PreparedIndexFile => item !== null);
        const failed = uris.filter((uri) =>
            !prepared.some((file) => file.uri.toString() === uri.toString())
        );
        const parsed = await this.parsePreparedFiles(prepared);
        const snapshot: IndexSnapshot = {
            index: new NamespaceIndex(),
            fileIndex: new Map(),
        };

        this.applyParsedFiles(prepared, parsed, snapshot.index, snapshot.fileIndex);

        for (const uri of failed) {
            const preserved = preservedFiles.get(uri.toString());
            if (preserved === undefined) {
                continue;
            }

            const cacheEntries = preserved.entries.map((entry) => ({
                className: entry.className,
                fqcn: entry.fqcn,
                uri,
            }));
            snapshot.index.replaceFile(uri, cacheEntries);
            snapshot.fileIndex.set(uri.toString(), {
                mtime: preserved.mtime,
                entries: preserved.entries,
            });
        }

        return snapshot;
    }

    private applySnapshot(snapshot: IndexSnapshot): void {
        this.index.setEntries(snapshot.index.toEntries() as CacheEntry[]);
        this.fileIndex.clear();

        for (const [uriString, file] of snapshot.fileIndex) {
            this.fileIndex.set(uriString, file);
        }
    }

    private async parsePreparedFiles(files: PreparedIndexFile[]): Promise<ParsePhpFileResult[]> {
        const input: ParsePhpFileInput[] = files.map((file) => ({
            uri: file.uri.toString(),
            fsPath: file.uri.fsPath,
            text: Buffer.from(file.raw).toString('utf8'),
        }));

        try {
            const parsed: ParsePhpFileResult[] = [];
            for (let index = 0; index < input.length; index += NamespaceCache.fileBatchSize) {
                parsed.push(...await this.worker.run('parse', {
                    files: input.slice(index, index + NamespaceCache.fileBatchSize),
                }));
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            return parsed;
        } catch {
            return parsePhpFiles(input);
        }
    }

    private applyParsedFiles(
        prepared: PreparedIndexFile[],
        parsed: ParsePhpFileResult[],
        index: NamespaceIndex,
        fileIndex: Map<string, FileIndexEntry>
    ): void {
        const preparedByUri = new Map(prepared.map((file) => [file.uri.toString(), file]));

        for (const result of parsed) {
            const file = preparedByUri.get(result.uri);
            if (file === undefined) {
                continue;
            }

            const entries = result.entries.map((entry) => ({
                className: entry.className,
                fqcn: entry.fqcn,
                uri: file.uri,
            }));

            index.replaceFile(file.uri, entries);
            fileIndex.set(file.uri.toString(), {
                mtime: file.mtime,
                entries: result.entries,
            });
        }
    }

    private async reconcileInBackground(): Promise<void> {
        const generation = ++this.rebuildGeneration;
        this.rebuilding = true;

        try {
            await this.rebuildNow(undefined, generation);
        } finally {
            this.rebuilding = false;
            if (this.updateQueue.size > 0) {
                this.scheduleQueuedUpdate();
            }
        }
    }

    private async reconcilePersistedIndexInBackground(): Promise<void> {
        this.rebuilding = true;

        try {
            const changed = await this.incrementalUpdate();
            if (changed) {
                this.schedulePersistIndex();
                this.onDidUpdateEmitter.fire();
            }
        } finally {
            this.rebuilding = false;
            if (this.updateQueue.size > 0) {
                this.scheduleQueuedUpdate();
            }
        }
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
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) {
            const excludePatterns = indexExcludePatterns();
            const files = await vscode.workspace.findFiles(
                '**/*.php',
                buildIndexExcludeGlob(excludePatterns)
            );

            return files.filter((uri) =>
                shouldIncludePhpFile(uri.fsPath, [process.cwd()], excludePatterns)
            );
        }

        const files = new Map<string, vscode.Uri>();

        for (const folder of folders) {
            const excludePatterns = indexExcludePatterns(folder.uri);
            const found = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, '**/*.php'),
                buildIndexExcludeGlob(excludePatterns)
            );

            for (const uri of found) {
                if (shouldIncludePhpFile(uri.fsPath, [folder.uri.fsPath], excludePatterns)) {
                    files.set(uri.toString(), uri);
                }
            }
        }

        return [...files.values()];
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
        const roots = (vscode.workspace.workspaceFolders ?? []).map(
            (folder) => folder.uri.fsPath
        );

        return roots.length === 0 ? [process.cwd()] : roots;
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
            const text = Buffer.from(raw).toString('utf8');
            let parsed: Partial<PersistedIndexData>;

            try {
                parsed = await this.worker.run('decode', { text });
            } catch {
                parsed = decodePersistedIndex(text);
            }

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

        const files: Record<string, FileIndexEntry> = {};

        for (const [uriString, file] of this.fileIndex) {
            files[uriString] = {
                mtime: file.mtime,
                entries: file.entries,
            };
        }

        const indexUri = vscode.Uri.joinPath(this.storageUri, NamespaceCache.indexFileName);
        const persisted: PersistedIndexData = {
            version: NamespaceCache.indexVersion,
            files,
        };
        let text: string;

        try {
            text = await this.worker.run('encode', { value: persisted });
        } catch {
            text = encodePersistedIndex(persisted);
        }

        const encoded = Buffer.from(text, 'utf8');
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

    private async persistRebuiltIndex(persistMode: 'debounced' | 'immediate'): Promise<void> {
        if (persistMode === 'immediate') {
            if (this.persistTimer !== null) {
                clearTimeout(this.persistTimer);
                this.persistTimer = null;
            }
            await this.persistIndex();
            return;
        }

        this.schedulePersistIndex();
    }

    private schedulePersistIndex(): void {
        if (this.storageUri === undefined) {
            return;
        }

        if (this.persistTimer !== null) {
            clearTimeout(this.persistTimer);
        }

        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persistIndex();
        }, NamespaceCache.persistDebounceMs);
    }
}
