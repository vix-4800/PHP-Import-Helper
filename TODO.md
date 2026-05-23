# PHP Import Helper Readiness TODO

## Namespace Cache

- [x] Initialize namespace index on extension activation.
- [x] Respect `phpImportHelper.exclude` for all workspace scans.
- [x] Add PHP file watcher: create/change updates indexed entries.
- [x] Add PHP file watcher: delete removes indexed entries.
- [x] Refresh visible PHP diagnostics after index rebuild/update.
- [x] Add storage-backed cache persistence with index versioning.
- [ ] Verify multi-root workspace lookup/scanning boundaries.

## Import UX

- [x] Show QuickPick for ambiguous import candidates.
- [x] Show QuickPick for ambiguous expand candidates.
- [x] Detect import short-name conflicts.
- [x] Support alias prompt/flow for conflicts.
- [x] Add status messages for no result, ambiguous, already imported.

## Parser Robustness

- [x] Add `DeclarationParser` fallback for parse errors.
- [x] Verify/remove risky `php-parser` `php7: true` option.
- [x] Expand PHP 8.4 coverage: property hooks and asymmetric visibility.
- [ ] Make built-in class policy consistent between detector and diagnostics.

## Generate Namespace

- [x] Find nearest `composer.json` upward from current file.
- [x] Cover nested composer package paths.
- [ ] Add integration tests for insert and replace behaviour.

## Diagnostics

- [x] Cover same-namespace class when cache has multiple entries.
- [x] Cover global classes.
- [x] Cover lowercase aliases.
- [x] Cover heredoc/string/comment false positives in diagnostics.
- [x] Cover config toggles: `highlightNotImported`, `highlightNotUsed`, `ignoreList`.

## Save Hooks

- [ ] Verify save hook order: autoImport -> removeUnused -> sort.
- [x] Replace imported FQCNs during auto-import-on-save.
- [ ] Add integration coverage for save hooks.

## Docs And Release

- [ ] Sync README with final behaviour.
- [ ] Finalize package metadata and marketplace assets.
- [ ] Verify full CI on GitHub Actions.
