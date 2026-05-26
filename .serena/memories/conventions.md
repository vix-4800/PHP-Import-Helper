# Conventions

- 4-space indentation, single quotes, semicolons.
- Prefer `import type` for type-only imports.
- Public command/config ids use `phpImportHelper.*`.
- Parsing/editing logic stays in focused `src/core/` modules.
- `src/extension.ts` remains registration-only.
- Comments only for non-obvious parsing or VS Code integration constraints.
- TDD required for requested behavior changes: failing test first, then minimal impl.
- User-visible command/config behavior changes require `package.json`, README, tests. 
- Keep changes local; no speculative abstractions/refactors.