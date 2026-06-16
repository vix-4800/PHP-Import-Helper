# AI Coding Agent Instructions

## Project Scope

This repository is a bundled VS Code extension for PHP import management. It imports, expands, sorts, folds, diagnoses, and removes PHP `use` statements.

## Repository Map

- `src/extension.ts`: extension activation, command/provider/hook registration.
- `src/core/`: parsing, detection, resolving, sorting, import edit planning, folding calculation.
- `src/features/`: VS Code commands, diagnostics, code actions, save hooks, folding provider.
- `src/utils/`: config and editor helpers.
- `src/test/unit/`: pure unit tests.
- `src/test/integration/`: VS Code integration tests.
- `dist/` and `out/`: generated output. Do not edit by hand.

## Change Rules

- Keep `src/extension.ts` thin.
- Use `phpImportHelper.*` for public command and config IDs.
- Always use TDD: write failing unit test first, confirm it fails, then implement.
- Fix root causes, not individual observed examples. Do not patch only the reported narrow case; identify the underlying failure class and cover representative similar cases.
- Use abstract, minimal fixture code in tests. Do not copy real project files, real app paths, or concrete application code; model the behavior with generic names.
- Keep changes local to requested behaviour.
- Do not add abstractions for future flexibility.
- If user-visible command/config behaviour changes, update `package.json`, README, and tests.
- After new features or updates, always update `CHANGELOG.md`.

## Code Style

- TypeScript, strict mode, 4-space indentation, single quotes, semicolons.
- Prefer `import type` for type-only imports.
- Keep parsing/editing logic in focused modules.
- Comments only for non-obvious parsing or VS Code integration constraints.

## Validation

- `npm run lint`
- `npm run check-types`
- `npm run package`
- `npm run test:unit`
- Do not run `npm run test:integration` or `npm test` by default. VS Code integration tests do not work reliably in this environment; ask the user to run them if needed.
