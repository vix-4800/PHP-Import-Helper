# Tech Stack

- TypeScript strict mode.
- VS Code extension target: `@types/vscode` / engine `^1.120.0`.
- Runtime dep: `php-parser`.
- Build: `esbuild.js` plus `tsc`.
- Tests: Mocha TDD UI; integration via `@vscode/test-electron`.
- Package manager: npm; scripts in `package.json`.