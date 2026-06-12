const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    const contexts = await Promise.all([
        contextFor('src/extension.ts', 'dist/extension.js'),
        contextFor('src/core/indexWorker.ts', 'dist/indexWorker.js'),
    ]);

    if (watch) {
        await Promise.all(contexts.map((ctx) => ctx.watch()));
    } else {
        await Promise.all(contexts.map((ctx) => ctx.rebuild()));
        await Promise.all(contexts.map((ctx) => ctx.dispose()));
    }
}

async function contextFor(entryPoint, outfile) {
    return await esbuild.context({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile,
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [
            /* Add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
