import * as assert from 'assert';
import { ComposerIndexSourcePlanner } from '../../core/ComposerIndexSourcePlanner';

class MemoryWorkspace {
    public constructor(private readonly files: Record<string, string>) {}

    public async readFile(filePath: string): Promise<string> {
        const value = this.files[filePath];
        if (value === undefined) {
            throw new Error(`Missing file: ${filePath}`);
        }

        return value;
    }

    public async pathExists(filePath: string): Promise<boolean> {
        return this.files[filePath] !== undefined ||
            Object.keys(this.files).some((candidate) => candidate.startsWith(`${filePath}/`));
    }

    public async findFiles(root: string, fileName: string): Promise<string[]> {
        return Object.keys(this.files)
            .filter((candidate) => candidate.startsWith(`${root}/`) || candidate === `${root}/${fileName}`)
            .filter((candidate) => candidate.endsWith(`/${fileName}`))
            .sort();
    }
}

suite('ComposerIndexSourcePlanner', () => {
    test('uses Composer PSR-4 roots instead of entire workspace', async () => {
        const planner = new ComposerIndexSourcePlanner(new MemoryWorkspace({
            '/workspace/composer.json': JSON.stringify({
                autoload: { 'psr-4': { 'App\\': 'app/' } },
            }),
            '/workspace/app/User.php': '<?php',
            '/workspace/legacy/LegacyUser.php': '<?php',
        }));

        const plan = await planner.plan(['/workspace'], []);

        assert.deepStrictEqual(plan.projectRoots, ['/workspace/app']);
    });

    test('includes autoload-dev roots', async () => {
        const planner = new ComposerIndexSourcePlanner(new MemoryWorkspace({
            '/workspace/composer.json': JSON.stringify({
                autoload: { 'psr-4': { 'App\\': 'app/' } },
                'autoload-dev': { 'psr-4': { 'Tests\\': 'tests/' } },
            }),
            '/workspace/app/User.php': '<?php',
            '/workspace/tests/UserTest.php': '<?php',
        }));

        const plan = await planner.plan(['/workspace'], []);

        assert.deepStrictEqual(plan.projectRoots, ['/workspace/app', '/workspace/tests']);
    });

    test('falls back to existing app and src directories without Composer', async () => {
        const planner = new ComposerIndexSourcePlanner(new MemoryWorkspace({
            '/workspace/app/User.php': '<?php',
            '/workspace/src/Domain/User.php': '<?php',
            '/workspace/lib/LegacyUser.php': '<?php',
        }));

        const plan = await planner.plan(['/workspace'], []);

        assert.deepStrictEqual(plan.projectRoots, ['/workspace/app', '/workspace/src']);
    });

    test('filters planned roots through index excludes', async () => {
        const planner = new ComposerIndexSourcePlanner(new MemoryWorkspace({
            '/workspace/composer.json': JSON.stringify({
                autoload: {
                    'psr-4': {
                        'App\\': 'app/',
                        'Generated\\': 'generated/',
                    },
                },
            }),
            '/workspace/app/User.php': '<?php',
            '/workspace/generated/User.php': '<?php',
        }));

        const plan = await planner.plan(['/workspace'], ['**/generated/**']);

        assert.deepStrictEqual(plan.projectRoots, ['/workspace/app']);
    });

    test('plans roots for nested Composer packages separately', async () => {
        const planner = new ComposerIndexSourcePlanner(new MemoryWorkspace({
            '/workspace/composer.json': JSON.stringify({
                autoload: { 'psr-4': { 'App\\': 'app/' } },
            }),
            '/workspace/packages/blog/composer.json': JSON.stringify({
                autoload: { 'psr-4': { 'Blog\\': 'src/' } },
            }),
            '/workspace/app/User.php': '<?php',
            '/workspace/packages/blog/src/Post.php': '<?php',
        }));

        const plan = await planner.plan(['/workspace'], []);

        assert.deepStrictEqual(plan.projectRoots, [
            '/workspace/app',
            '/workspace/packages/blog/src',
        ]);
        assert.deepStrictEqual(plan.composerFiles, [
            '/workspace/composer.json',
            '/workspace/packages/blog/composer.json',
        ]);
    });
});
