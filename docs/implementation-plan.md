# PHP Import Helper Implementation Plan

## Summary

Build a VS Code extension for PHP import management from scratch. The original `PHP-Import-Resolver` repository is only a functional reference for behaviour and edge cases; do not copy its implementation.

Use TypeScript, VS Code Extension API, `php-parser` as the AST dependency, and esbuild bundling to `dist/extension.js` with `vscode` external.

## Public API

Commands use the `phpImportHelper.*` namespace:

- `phpImportHelper.import`
- `phpImportHelper.importAll`
- `phpImportHelper.expand`
- `phpImportHelper.sort`
- `phpImportHelper.foldUses`
- `phpImportHelper.removeUnused`
- `phpImportHelper.generateNamespace`
- `phpImportHelper.rebuildIndex`

Settings use the same namespace:

- `phpImportHelper.exclude`
- `phpImportHelper.autoSort`
- `phpImportHelper.autoFoldUses`
- `phpImportHelper.sortOnSave`
- `phpImportHelper.sortMode`: `natural | length | alphabetical`
- `phpImportHelper.leadingSeparator`
- `phpImportHelper.removeOnSave`
- `phpImportHelper.autoImportOnSave`
- `phpImportHelper.ignoreList`
- `phpImportHelper.highlightNotImported`
- `phpImportHelper.highlightNotUsed`

## Implementation

- Replace hello-world scaffold with PHP activation, commands, menus, config, keybindings, docs, CI, and `AGENTS.md`.
- Add test layout: unit tests for pure logic, integration tests for VS Code wiring.
- Core modules:
  - AST parser wrapper around `php-parser`.
  - Declaration/import parser for namespace, declare, class/interface/trait/enum, normal/grouped/multiline imports, aliases, `use function`, `use const`.
  - PHP reference detector for extends/implements, params, returns, properties, constants, `new`, static access, instanceof, catch, attributes, traits, PHPDoc tags.
  - Import edit engine for insertion, alias conflicts, FQCN replacement, grouped import collapse, blank-line cleanup.
  - Sort engine with kind groups and `natural | length | alphabetical` modes.
  - Composer resolver for PSR-4/PSR-0, `autoload`, `autoload-dev`, multi-path mappings.
  - Workspace-scoped namespace cache and rebuild command.
- VS Code features:
  - Commands for import/importAll/expand/sort/fold/removeUnused/generateNamespace/rebuildIndex.
  - Diagnostics for not imported / not used.
  - Quick fixes for import, expand, remove unused.
  - Save hooks for sort/remove/auto-import.
  - Folding provider for top-level import blocks.

## Test Plan

Write failing tests before implementation.

- Unit tests: parser, detector, sanitizer, composer resolver, sort, import edit planning, folding range calculator.
- Integration tests: editor command effects, diagnostics, code actions, save hooks, folding provider, cache rebuild behaviour.
- CI: Linux/macOS/Windows with Node 22 and 24, `npm ci`, lint, typecheck/build, unit tests, integration tests with Xvfb on Linux.

## Assumptions

- npm is package manager.
- New extension has no compatibility aliases for `phpNamespaceResolver.*`.
- `php-parser` is bundled by esbuild; `vscode` remains external.
- First implementation target is full v1 parity.
