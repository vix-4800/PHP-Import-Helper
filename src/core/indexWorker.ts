import { parentPort } from 'node:worker_threads';
import {
    decodePersistedIndex,
    encodePersistedIndex,
    parsePhpFiles,
} from './indexWorkerTasks';

interface WorkerRequest {
    id?: unknown;
    task?: unknown;
    input?: unknown;
}

function runTask(task: unknown, input: unknown): unknown {
    if (task === 'decode') {
        const value = input as { text?: unknown };
        if (typeof value.text !== 'string') {
            throw new Error('Invalid decode worker input.');
        }

        return decodePersistedIndex(value.text);
    }

    if (task === 'encode') {
        return encodePersistedIndex((input as { value: never }).value);
    }

    if (task === 'parse') {
        const value = input as { files?: unknown };
        if (!Array.isArray(value.files)) {
            throw new Error('Invalid parse worker input.');
        }

        return parsePhpFiles(value.files);
    }

    throw new Error(`Unknown index worker task: ${String(task)}.`);
}

parentPort?.on('message', (message: WorkerRequest) => {
    if (typeof message.id !== 'number') {
        return;
    }

    try {
        parentPort?.postMessage({
            id: message.id,
            ok: true,
            result: runTask(message.task, message.input),
        });
    } catch (error) {
        parentPort?.postMessage({
            id: message.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
