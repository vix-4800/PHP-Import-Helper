import * as assert from 'assert';
import {
    IndexWorkerClient,
    type WorkerLike,
} from '../../core/IndexWorkerClient';

class FakeWorker implements WorkerLike {
    private readonly listeners = new Map<string, Array<(value: unknown) => void>>();
    public readonly messages: unknown[] = [];

    public postMessage(value: unknown): void {
        this.messages.push(value);
    }

    public on(event: 'error' | 'exit' | 'message', listener: (value: unknown) => void): this {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
        return this;
    }

    public emit(event: 'error' | 'exit' | 'message', value: unknown): void {
        for (const listener of this.listeners.get(event) ?? []) {
            listener(value);
        }
    }

    public async terminate(): Promise<number> {
        return 0;
    }
}

suite('IndexWorkerClient', () => {
    test('matches concurrent responses to their requests', async () => {
        const worker = new FakeWorker();
        const client = new IndexWorkerClient(worker);
        const first = client.run('decode', { text: '{"first":true}' });
        const second = client.run('decode', { text: '{"second":true}' });
        const firstRequest = worker.messages[0] as { id: number };
        const secondRequest = worker.messages[1] as { id: number };

        worker.emit('message', {
            id: secondRequest.id,
            ok: true,
            result: { second: true },
        });
        worker.emit('message', {
            id: firstRequest.id,
            ok: true,
            result: { first: true },
        });

        assert.deepStrictEqual(await first, { first: true });
        assert.deepStrictEqual(await second, { second: true });
        await client.dispose();
    });

    test('rejects pending requests when worker fails', async () => {
        const worker = new FakeWorker();
        const client = new IndexWorkerClient(worker);
        const pending = client.run('decode', { text: '{}' });

        worker.emit('error', new Error('worker failed'));

        await assert.rejects(pending, /worker failed/);
        await client.dispose();
    });
});
