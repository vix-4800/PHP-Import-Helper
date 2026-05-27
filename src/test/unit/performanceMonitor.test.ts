import * as assert from 'assert';
import {
    PerformanceMonitor,
    formatPerformanceStats,
    type OutputChannelLike,
} from '../../features/PerformanceMonitor';

suite('PerformanceMonitor', () => {
    test('tracks diagnostics cache and watcher stats and writes trace lines', () => {
        const lines: string[] = [];
        const channel: OutputChannelLike = {
            appendLine: (value) => lines.push(value),
            show: () => undefined,
        };
        let now = 1_000;
        const monitor = new PerformanceMonitor(channel, () => now);

        monitor.recordWatcherEvent({ ignored: false });
        now += 100;
        monitor.recordWatcherEvent({ ignored: true });
        now += 100;
        monitor.recordDiagnosticsUpdate({
            fileName: 'BookController.php',
            version: 128,
            ms: 42,
            refs: 18,
            trace: true,
        });
        now += 100;
        monitor.recordIndexBatch({
            changed: 3,
            deleted: 1,
            readMs: 80,
            parseMs: 120,
            persistMs: 30,
            durationMs: 240,
            trace: true,
        });
        now += 100;
        monitor.recordCachePersist({
            files: 20,
            bytes: 5120,
            ms: 15,
            trace: true,
        });
        now += 100;
        monitor.recordRebuildDuration(900);

        const stats = monitor.snapshot({
            indexedFiles: 20,
            indexedClasses: 42,
        });

        assert.strictEqual(stats.indexedFiles, 20);
        assert.strictEqual(stats.indexedClasses, 42);
        assert.strictEqual(stats.persistedIndexBytes, 5120);
        assert.strictEqual(stats.lastRebuildDurationMs, 900);
        assert.strictEqual(stats.lastUpdateDurationMs, 240);
        assert.strictEqual(stats.lastDiagnosticsDurationMs, 42);
        assert.strictEqual(stats.watcherEventsLastMinute, 2);
        assert.strictEqual(stats.ignoredWatcherEventsLastMinute, 1);
        assert.deepStrictEqual(lines, [
            '[php-import-helper] diagnostics.update file=BookController.php version=128 ms=42 refs=18',
            '[php-import-helper] index.batch changed=3 deleted=1 readMs=80 parseMs=120 persistMs=30',
            '[php-import-helper] cache.persist files=20 bytes=5120 ms=15',
        ]);
    });

    test('formats performance stats for output channel', () => {
        const text = formatPerformanceStats({
            indexedFiles: 20,
            indexedClasses: 42,
            persistedIndexBytes: 5120,
            lastRebuildDurationMs: 900,
            lastUpdateDurationMs: 240,
            lastDiagnosticsDurationMs: 42,
            watcherEventsLastMinute: 12,
            ignoredWatcherEventsLastMinute: 5,
        });

        assert.ok(text.includes('Indexed files: 20'));
        assert.ok(text.includes('Indexed classes: 42'));
        assert.ok(text.includes('Persisted index bytes: 5120'));
        assert.ok(text.includes('Last rebuild duration: 900 ms'));
        assert.ok(text.includes('Last update duration: 240 ms'));
        assert.ok(text.includes('Last diagnostics duration: 42 ms'));
        assert.ok(text.includes('Watcher events last minute: 12'));
        assert.ok(text.includes('Ignored watcher events last minute: 5'));
    });
});
