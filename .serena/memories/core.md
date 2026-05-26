# Core

VS Code extension for PHP import management.

Source map:
- `src/extension.ts`: activation, command/provider/hook registration; keep thin.
- `src/core/`: parsing, class detection, namespace resolving, import edit planning, sorting, folding calculation.
- `src/features/`: VS Code commands, diagnostics, code actions, save hooks, folding provider.
- `src/utils/`: config/editor helpers.
- `src/test/unit/`: pure unit tests.
- `src/test/integration/`: VS Code integration tests.

Generated dirs: `dist/`, `out/`; do not hand-edit.

Read also: `mem:tech_stack`, `mem:conventions`, `mem:suggested_commands`, `mem:task_completion`.