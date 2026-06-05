import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const testRunId = `${Date.now()}-${process.pid}`;
    const testRoot =
        process.platform === 'darwin' ? '/tmp' : path.resolve(__dirname, '../..', '.vscode-test');
    const testDataPath = path.join(testRoot, `pih-user-${testRunId}`);
    const extensionDataPath = path.join(testRoot, `pih-ext-${testRunId}`);

    try {
        await runTests({
            extensionDevelopmentPath: path.resolve(__dirname, '../..'),
            extensionTestsPath: path.resolve(__dirname, './integration/index'),
            launchArgs: [
                '--disable-extensions',
                '--user-data-dir',
                testDataPath,
                '--extensions-dir',
                extensionDataPath,
            ],
            extensionTestsEnv: {
                VSCODE_TEST_RUN_ID: testRunId,
            },
        });
    } catch (error) {
        console.error('Failed to run integration tests:', error);
        process.exit(1);
    }
}

void main();
