export interface OutputChannelLike {
    appendLine(value: string): void;
    show(preserveFocus?: boolean): void;
}

export interface PerformanceSnapshot {
    indexedFiles: number;
    indexedClasses: number;
    persistedIndexBytes: number | null;
    lastRebuildDurationMs: number | null;
    lastUpdateDurationMs: number | null;
    lastDiagnosticsDurationMs: number | null;
    watcherEventsLastMinute: number;
    ignoredWatcherEventsLastMinute: number;
}

type DiagnosticsUpdate = {
    fileName: string;
    version: number;
    ms: number;
    refs: number;
    trace: boolean;
};

type IndexBatch = {
    changed: number;
    deleted: number;
    readMs: number;
    parseMs: number;
    persistMs: number;
    durationMs: number;
    trace: boolean;
};

type CachePersist = {
    files: number;
    bytes: number;
    ms: number;
    trace: boolean;
};

type WatcherEvent = {
    ignored: boolean;
};

export class PerformanceMonitor {
    private static readonly oneMinuteMs = 60_000;

    private lastDiagnosticsDurationMs: number | null = null;
    private lastUpdateDurationMs: number | null = null;
    private lastRebuildDurationMs: number | null = null;
    private persistedIndexBytes: number | null = null;
    private readonly watcherEvents: number[] = [];
    private readonly ignoredWatcherEvents: number[] = [];

    public constructor(
        private readonly output: OutputChannelLike,
        private readonly now: () => number = () => Date.now()
    ) {}

    public recordWatcherEvent(event: WatcherEvent): void {
        const current = this.now();
        this.watcherEvents.push(current);
        if (event.ignored) {
            this.ignoredWatcherEvents.push(current);
        }
        this.prune(current);
    }

    public recordDiagnosticsUpdate(update: DiagnosticsUpdate): void {
        this.lastDiagnosticsDurationMs = update.ms;

        if (!update.trace) {
            return;
        }

        this.output.appendLine(
            `[php-import-helper] diagnostics.update file=${update.fileName} version=${update.version} ms=${update.ms} refs=${update.refs}`
        );
    }

    public recordIndexBatch(batch: IndexBatch): void {
        this.lastUpdateDurationMs = batch.durationMs;

        if (!batch.trace) {
            return;
        }

        this.output.appendLine(
            `[php-import-helper] index.batch changed=${batch.changed} deleted=${batch.deleted} readMs=${batch.readMs} parseMs=${batch.parseMs} persistMs=${batch.persistMs}`
        );
    }

    public recordCachePersist(persist: CachePersist): void {
        this.persistedIndexBytes = persist.bytes;

        if (!persist.trace) {
            return;
        }

        this.output.appendLine(
            `[php-import-helper] cache.persist files=${persist.files} bytes=${persist.bytes} ms=${persist.ms}`
        );
    }

    public recordRebuildDuration(ms: number): void {
        this.lastRebuildDurationMs = ms;
    }

    public snapshot(index: { indexedFiles: number; indexedClasses: number }): PerformanceSnapshot {
        const current = this.now();
        this.prune(current);

        return {
            indexedFiles: index.indexedFiles,
            indexedClasses: index.indexedClasses,
            persistedIndexBytes: this.persistedIndexBytes,
            lastRebuildDurationMs: this.lastRebuildDurationMs,
            lastUpdateDurationMs: this.lastUpdateDurationMs,
            lastDiagnosticsDurationMs: this.lastDiagnosticsDurationMs,
            watcherEventsLastMinute: this.watcherEvents.length,
            ignoredWatcherEventsLastMinute: this.ignoredWatcherEvents.length,
        };
    }

    public showStats(snapshot: PerformanceSnapshot): void {
        this.output.appendLine(formatPerformanceStats(snapshot));
        this.output.show(true);
    }

    private prune(current: number): void {
        this.pruneQueue(this.watcherEvents, current);
        this.pruneQueue(this.ignoredWatcherEvents, current);
    }

    private pruneQueue(values: number[], current: number): void {
        while (
            values.length > 0 &&
            current - values[0]! >= PerformanceMonitor.oneMinuteMs
        ) {
            values.shift();
        }
    }
}

export function formatPerformanceStats(snapshot: PerformanceSnapshot): string {
    return [
        'PHP Import Helper Performance Stats',
        `Indexed files: ${snapshot.indexedFiles}`,
        `Indexed classes: ${snapshot.indexedClasses}`,
        `Persisted index bytes: ${snapshot.persistedIndexBytes ?? 'n/a'}`,
        `Last rebuild duration: ${formatDuration(snapshot.lastRebuildDurationMs)}`,
        `Last update duration: ${formatDuration(snapshot.lastUpdateDurationMs)}`,
        `Last diagnostics duration: ${formatDuration(snapshot.lastDiagnosticsDurationMs)}`,
        `Watcher events last minute: ${snapshot.watcherEventsLastMinute}`,
        `Ignored watcher events last minute: ${snapshot.ignoredWatcherEventsLastMinute}`,
    ].join('\n');
}

function formatDuration(value: number | null): string {
    return value === null ? 'n/a' : `${value} ms`;
}
