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
    ComposerIndexSourcePlanner,
    type ComposerIndexSourcePlan,
    type ComposerIndexSourcePlannerWorkspace,
} from './ComposerIndexSourcePlanner';
import { ComposerVendorMapParser } from './ComposerVendorMapParser';
import { NamespaceCacheUpdateQueue } from './NamespaceCacheUpdateQueue';
import { NamespaceIndex } from './NamespaceIndex';

interface PersistedEntry {
    className: string;
    fqcn: string;
    uri: string;
}

interface FileIndexEntry {
    mtime: number;
    entries: PersistedEntry[];
}

function cacheEntryToPersisted(entry: CacheEntry): PersistedEntry {
    return {
        className: entry.className,
        fqcn: entry.fqcn,
        uri: entry.uri.toString(),
    };
}

export class NamespaceCache implements vscode.Disposable {
    private static readonly indexVersion = 2;
    private static readonly indexFileName = 'namespace-index.json';
    private static readonly fileBatchSize = 64;
    private static readonly statBatchSize = 256;
    private static readonly updateDebounceMs = 1000;

    private readonly index = new NamespaceIndex();
    private readonly fileIndex = new Map<string, FileIndexEntry>();
    private readonly dependencyIndex = new Map<string, number>();
    private readonly vendorMapParser = new ComposerVendorMapParser();
    private readonly watchers: vscode.FileSystemWatcher[] = [];
    private updateTimer: ReturnType<typeof setTimeout> | null = null;
    private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    private sourcePlan: ComposerIndexSourcePlan | null = null;
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
        this.dependencyIndex.clear();

        for (const entry of entries) {
            const sourceUri = entry.sourceUri ?? entry.uri;
            const uriString = sourceUri.toString();
            const file = this.fileIndex.get(uriString) ?? { mtime: 0, entries: [] };
            file.entries.push(cacheEntryToPersisted(entry));
            this.fileIndex.set(uriString, file);
        }
    }

    public add(entry: CacheEntry): void {
        this.index.add(entry);
        const sourceUri = entry.sourceUri ?? entry.uri;
        const uriString = sourceUri.toString();
        const file = this.fileIndex.get(uriString) ?? { mtime: 0, entries: [] };
        file.entries.push(cacheEntryToPersisted(entry));
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
        this.dependencyIndex.clear();
        const sourcePlan = await this.buildSourcePlan();
        this.sourcePlan = sourcePlan;
        const files = await this.findIndexedPhpFiles(sourcePlan);

        await this.indexFiles(files);
        await this.indexVendorMaps(sourcePlan);
        await this.recordDependencyFiles(sourcePlan);
        await this.persistIndex();
        this.onDidUpdateEmitter.fire();
    }

    private async initializeNow(): Promise<void> {
        const loaded = await this.loadPersistedIndex();

        if (!loaded) {
            await this.rebuildNow();
        } else {
            const sourcePlan = await this.buildSourcePlan();
            this.sourcePlan = sourcePlan;
            if (await this.dependenciesChanged(sourcePlan)) {
                await this.rebuildNow();
            } else {
                const changed = await this.incrementalUpdate(sourcePlan);
                if (changed) {
                    await this.persistIndex();
                }
                this.onDidUpdateEmitter.fire();
            }
        }

        this.createWatchers();
    }

    public dispose(): void {
        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        if (this.rebuildTimer !== null) {
            clearTimeout(this.rebuildTimer);
        }
        this.updateTimer = null;
        this.rebuildTimer = null;

        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers.length = 0;
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

    private createWatchers(): void {
        const phpWatcher = vscode.workspace.createFileSystemWatcher('**/*.php');
        phpWatcher.onDidCreate((uri) => this.scheduleIndexFile(uri));
        phpWatcher.onDidChange((uri) => this.scheduleIndexFile(uri));
        phpWatcher.onDidDelete((uri) => this.scheduleRemoveFile(uri));
        this.watchers.push(phpWatcher);

        for (const pattern of [
            '**/composer.json',
            '**/composer.lock',
            '**/vendor/composer/autoload_*.php',
        ]) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidCreate((uri) => this.scheduleDependencyRebuild(uri));
            watcher.onDidChange((uri) => this.scheduleDependencyRebuild(uri));
            watcher.onDidDelete((uri) => this.scheduleDependencyRebuild(uri));
            this.watchers.push(watcher);
        }
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

    private scheduleDependencyRebuild(_uri: vscode.Uri): void {
        this.performance?.recordWatcherEvent({ ignored: false });

        if (this.rebuildTimer !== null) {
            clearTimeout(this.rebuildTimer);
        }

        this.rebuildTimer = setTimeout(() => {
            this.rebuildTimer = null;
            void this.rebuild();
        }, NamespaceCache.updateDebounceMs);
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

                const metrics = await this.indexFiles(batch.changed.filter((uri) =>
                    this.shouldIndexWatchedUri(uri)
                ));
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
            const entries = NamespaceIndex.entriesFromPhpFile(uri, text) as CacheEntry[];
            const parseMs = Date.now() - parseStartedAt;

            this.index.replaceFile(uri, entries);
            this.fileIndex.set(uri.toString(), {
                mtime: stat.mtime,
                entries: entries.map(cacheEntryToPersisted),
            });

            return { readMs, parseMs };
        } catch {
            this.removeFile(uri);
            return { readMs: 0, parseMs: 0 };
        }
    }

    private async indexVendorMap(mapUri: vscode.Uri): Promise<void> {
        try {
            const [raw, stat] = await Promise.all([
                vscode.workspace.fs.readFile(mapUri),
                vscode.workspace.fs.stat(mapUri),
            ]);
            const parsed = this.vendorMapParser.parse(
                mapUri.fsPath,
                Buffer.from(raw).toString('utf8')
            );
            const entries = parsed.map((entry) => ({
                className: entry.className,
                fqcn: entry.fqcn,
                uri: vscode.Uri.file(entry.uri.fsPath),
                sourceUri: mapUri,
            }));

            this.index.replaceFile(mapUri, entries);
            this.fileIndex.set(mapUri.toString(), {
                mtime: stat.mtime,
                entries: entries.map(cacheEntryToPersisted),
            });
        } catch {
            this.removeFile(mapUri);
        }
    }

    private async indexVendorMaps(sourcePlan: ComposerIndexSourcePlan): Promise<void> {
        await this.mapInBatches(sourcePlan.vendorMapFiles, NamespaceCache.fileBatchSize, async (filePath) => {
            await this.indexVendorMap(vscode.Uri.file(filePath));
        });
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

    private async incrementalUpdate(sourcePlan: ComposerIndexSourcePlan): Promise<boolean> {
        const files = await this.findIndexedPhpFiles(sourcePlan);
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
            if (!seen.has(uriString) && this.isInPlannedProjectRoots(uri)) {
                this.removeFile(uri);
                changed = true;
            }
        }

        return changed;
    }

    private async findIndexedPhpFiles(sourcePlan: ComposerIndexSourcePlan): Promise<vscode.Uri[]> {
        const coarseExclude = buildIndexExcludeGlob(indexExcludePatterns());
        const files = new Map<string, vscode.Uri>();

        for (const root of sourcePlan.projectRoots) {
            if (root.endsWith('.php')) {
                const uri = vscode.Uri.file(root);
                if (this.shouldIndexProjectUri(uri, sourcePlan)) {
                    files.set(uri.toString(), uri);
                }
                continue;
            }

            const pattern = new vscode.RelativePattern(root, '**/*.php');
            for (const uri of await vscode.workspace.findFiles(pattern, coarseExclude)) {
                if (this.shouldIndexProjectUri(uri, sourcePlan)) {
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

    private isInPlannedProjectRoots(uri: vscode.Uri): boolean {
        return this.sourcePlan !== null && isWithinRoots(uri.fsPath, this.sourcePlan.projectRoots);
    }

    private shouldIndexWatchedUri(uri: vscode.Uri): boolean {
        return this.sourcePlan !== null && this.shouldIndexProjectUri(uri, this.sourcePlan);
    }

    private shouldIndexProjectUri(uri: vscode.Uri, sourcePlan: ComposerIndexSourcePlan): boolean {
        return uri.scheme === 'file' &&
            shouldIncludePhpFile(uri.fsPath, sourcePlan.projectRoots, indexExcludePatterns(uri));
    }

    private shouldRefreshPersistedFile(uri: vscode.Uri): boolean {
        if (uri.scheme !== 'file' || !uri.fsPath.endsWith('.php')) {
            return false;
        }

        return this.sourcePlan !== null &&
            shouldIncludePhpFile(uri.fsPath, this.sourcePlan.projectRoots, indexExcludePatterns(uri));
    }

    private workspaceRoots(): string[] {
        const roots = new Set(
            (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)
        );

        roots.add(process.cwd());

        return [...roots];
    }

    private async buildSourcePlan(): Promise<ComposerIndexSourcePlan> {
        const planner = new ComposerIndexSourcePlanner(this.plannerWorkspace());

        return await planner.plan(this.workspaceRoots(), indexExcludePatterns());
    }

    private plannerWorkspace(): ComposerIndexSourcePlannerWorkspace {
        return {
            readFile: async (filePath) => Buffer.from(
                await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
            ).toString('utf8'),
            pathExists: async (filePath) => {
                try {
                    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                    return true;
                } catch {
                    return false;
                }
            },
            findFiles: async (root, fileName) => {
                const pattern = new vscode.RelativePattern(root, `**/${fileName}`);
                const files = await vscode.workspace.findFiles(pattern, buildIndexExcludeGlob(indexExcludePatterns()));

                return files.map((uri) => uri.fsPath);
            },
        };
    }

    private async dependenciesChanged(sourcePlan: ComposerIndexSourcePlan): Promise<boolean> {
        for (const filePath of sourcePlan.dependencyFiles) {
            const uri = vscode.Uri.file(filePath);
            const uriString = uri.toString();
            const existingMtime = this.fileIndex.get(uriString)?.mtime ??
                this.dependencyIndex.get(uriString);

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (existingMtime === undefined || existingMtime !== stat.mtime) {
                    return true;
                }
            } catch {
                if (existingMtime !== undefined) {
                    return true;
                }
            }
        }

        return false;
    }

    private async recordDependencyFiles(sourcePlan: ComposerIndexSourcePlan): Promise<void> {
        for (const filePath of sourcePlan.dependencyFiles) {
            const uri = vscode.Uri.file(filePath);
            const uriString = uri.toString();

            if (this.fileIndex.has(uriString)) {
                continue;
            }

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                this.dependencyIndex.set(uriString, stat.mtime);
            } catch {
                this.dependencyIndex.delete(uriString);
            }
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
                files?: Record<string, {
                    mtime?: number;
                    entries?: Array<{ className?: string; fqcn?: string; uri?: string }>;
                }>;
                dependencies?: Record<string, { mtime?: number }>;
            };

            if (parsed.version !== NamespaceCache.indexVersion || parsed.files === undefined) {
                return false;
            }

            const entries: CacheEntry[] = [];
            const persistedFileIndex = new Map<string, FileIndexEntry>();
            for (const [sourceUriString, file] of Object.entries(parsed.files)) {
                const sourceUri = vscode.Uri.parse(sourceUriString);
                const fileEntries: PersistedEntry[] = [];

                for (const entry of file.entries ?? []) {
                    if (
                        typeof entry.className !== 'string' ||
                        typeof entry.fqcn !== 'string' ||
                        typeof entry.uri !== 'string'
                    ) {
                        continue;
                    }

                    entries.push({
                        className: entry.className,
                        fqcn: entry.fqcn,
                        uri: vscode.Uri.parse(entry.uri),
                        sourceUri,
                    });
                    fileEntries.push({
                        className: entry.className,
                        fqcn: entry.fqcn,
                        uri: entry.uri,
                    });
                }

                persistedFileIndex.set(sourceUriString, {
                    mtime: typeof file.mtime === 'number' ? file.mtime : 0,
                    entries: fileEntries,
                });
            }

            this.index.setEntries(entries);
            this.fileIndex.clear();
            for (const [uriString, file] of persistedFileIndex) {
                this.fileIndex.set(uriString, file);
            }
            this.dependencyIndex.clear();
            for (const [uriString, dependency] of Object.entries(parsed.dependencies ?? {})) {
                if (typeof dependency.mtime === 'number') {
                    this.dependencyIndex.set(uriString, dependency.mtime);
                }
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
        const dependencies: Record<string, { mtime: number }> = {};

        for (const [uriString, file] of this.fileIndex) {
            files[uriString] = {
                mtime: file.mtime,
                entries: file.entries,
            };
        }
        for (const [uriString, mtime] of this.dependencyIndex) {
            dependencies[uriString] = { mtime };
        }

        const indexUri = vscode.Uri.joinPath(this.storageUri, NamespaceCache.indexFileName);
        const encoded = Buffer.from(JSON.stringify({
            version: NamespaceCache.indexVersion,
            files,
            dependencies,
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
