import * as assert from 'assert';

type CacheActivityEvent = {
    kind: 'start' | 'end';
    phase: 'initialize' | 'rebuild' | 'update';
};

type StatusBarItemLike = {
    text: string;
    tooltip?: string;
    show(): void;
    hide(): void;
};

suite('CacheStatusBarController', () => {
    test('shows spinner while cache is building and hides it when done', () => {
        const { CacheStatusBarController } = require('../../features/CacheStatusBarController') as {
            CacheStatusBarController: new (item: StatusBarItemLike) => {
                handleActivity(event: CacheActivityEvent): void;
            };
        };
        const calls: string[] = [];
        const item: StatusBarItemLike = {
            text: '',
            show: () => calls.push('show'),
            hide: () => calls.push('hide'),
        };
        const controller = new CacheStatusBarController(item);

        controller.handleActivity({ kind: 'start', phase: 'initialize' });

        assert.strictEqual(item.text, '$(sync~spin) PHP Import Helper: building cache');
        assert.strictEqual(item.tooltip, 'PHP Import Helper is building namespace cache.');
        assert.deepStrictEqual(calls, ['show']);

        controller.handleActivity({ kind: 'end', phase: 'initialize' });

        assert.deepStrictEqual(calls, ['show', 'hide']);
    });

    test('uses update label for watched cache refreshes', () => {
        const { CacheStatusBarController } = require('../../features/CacheStatusBarController') as {
            CacheStatusBarController: new (item: StatusBarItemLike) => {
                handleActivity(event: CacheActivityEvent): void;
            };
        };
        const item: StatusBarItemLike = {
            text: '',
            show: () => undefined,
            hide: () => undefined,
        };
        const controller = new CacheStatusBarController(item);

        controller.handleActivity({ kind: 'start', phase: 'update' });

        assert.strictEqual(item.text, '$(sync~spin) PHP Import Helper: updating cache');
        assert.strictEqual(item.tooltip, 'PHP Import Helper is updating namespace cache.');
    });
});
