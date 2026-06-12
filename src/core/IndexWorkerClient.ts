import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
    ParsePhpFileInput,
    ParsePhpFileResult,
    PersistedIndexData,
} from './indexWorkerTasks';

export interface WorkerLike {
    postMessage: (value: unknown) => void;
    on: (
        event: 'error' | 'exit' | 'message',
        listener: (value: unknown) => void
    ) => WorkerLike;
    terminate: () => Promise<number>;
}

export function createIndexWorkerClient(
    workerPath = path.join(__dirname, 'indexWorker.js')
): IndexWorkerClient {
    return new IndexWorkerClient(new Worker(workerPath));
}

type WorkerTaskMap = {
    decode: {
        input: { text: string };
        result: PersistedIndexData;
    };
    encode: {
        input: { value: PersistedIndexData };
        result: string;
    };
    parse: {
        input: { files: ParsePhpFileInput[] };
        result: ParsePhpFileResult[];
    };
};

type WorkerTaskName = keyof WorkerTaskMap;

interface WorkerRequest<TTask extends WorkerTaskName> {
    id: number;
    task: TTask;
    input: WorkerTaskMap[TTask]['input'];
}

interface WorkerResponse {
    id?: unknown;
    ok?: unknown;
    result?: unknown;
    error?: unknown;
}

export class IndexWorkerClient {
    private nextId = 1;
    private disposed = false;
    private readonly pending = new Map<
        number,
        {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
        }
    >();

    public constructor(private readonly worker: WorkerLike) {
        this.worker.on('message', (value) => this.handleMessage(value));
        this.worker.on('error', (value) => this.rejectAll(this.errorFrom(value)));
        this.worker.on('exit', (value) => {
            if (value !== 0) {
                this.rejectAll(new Error(`Index worker exited with code ${String(value)}.`));
            }
        });
    }

    public async run<TTask extends WorkerTaskName>(
        task: TTask,
        input: WorkerTaskMap[TTask]['input']
    ): Promise<WorkerTaskMap[TTask]['result']> {
        if (this.disposed) {
            throw new Error('Index worker is disposed.');
        }

        const id = this.nextId++;
        const request: WorkerRequest<TTask> = { id, task, input };
        const promise = new Promise<WorkerTaskMap[TTask]['result']>((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => resolve(value as WorkerTaskMap[TTask]['result']),
                reject,
            });
        });

        this.worker.postMessage(request);

        return await promise;
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
        this.rejectAll(new Error('Index worker is disposed.'));
        await this.worker.terminate();
    }

    private handleMessage(value: unknown): void {
        const response = value as WorkerResponse;
        if (typeof response.id !== 'number') {
            return;
        }

        const pending = this.pending.get(response.id);
        if (pending === undefined) {
            return;
        }

        this.pending.delete(response.id);

        if (response.ok === true) {
            pending.resolve(response.result);
            return;
        }

        pending.reject(new Error(
            typeof response.error === 'string' ? response.error : 'Index worker failed.'
        ));
    }

    private rejectAll(error: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }

        this.pending.clear();
    }

    private errorFrom(value: unknown): Error {
        return value instanceof Error ? value : new Error(String(value));
    }
}
