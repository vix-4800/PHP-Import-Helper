import * as path from 'path';
import type { AutoloadConfig } from './composer';
import { resolveNamespace } from './composer';

export function generateNamespace(filePath: string, autoload: AutoloadConfig): string | null {
    const directory = path.dirname(filePath);

    return resolveNamespace(directory, autoload);
}
