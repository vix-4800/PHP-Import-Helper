import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const testRunId = `${Date.now()}-${process.pid}`;
    const testDataPath = path.resolve(__dirname, '../..', '.vscode-test', `user-data-${testRunId}`);
    const extensionDataPath = path.resolve(__dirname, '../..', '.vscode-test', `extensions-${testRunId}`);

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
