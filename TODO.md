# PHP Import Helper Readiness TODO

## Namespace Cache

- [ ] Initialize namespace index on extension activation.
- [ ] Respect `phpImportHelper.exclude` for all workspace scans.
- [ ] Add PHP file watcher: create/change updates indexed entries.
- [ ] Add PHP file watcher: delete removes indexed entries.
- [ ] Refresh visible PHP diagnostics after index rebuild/update.
- [ ] Add storage-backed cache persistence with index versioning.
- [ ] Verify multi-root workspace lookup/scanning boundaries.

## Import UX

- [ ] Show QuickPick for ambiguous import candidates.
- [ ] Show QuickPick for ambiguous expand candidates.
- [ ] Detect import short-name conflicts.
- [ ] Support alias prompt/flow for conflicts.
- [ ] Add status messages for no result, ambiguous, already imported.

## Parser Robustness

- [ ] Add `DeclarationParser` fallback for parse errors.
- [ ] Verify/remove risky `php-parser` `php7: true` option.
- [ ] Expand PHP 8.4 coverage: property hooks and asymmetric visibility.
- [ ] Make built-in class policy consistent between detector and diagnostics.

## Generate Namespace

- [ ] Find nearest `composer.json` upward from current file.
- [ ] Cover nested composer package paths.
- [ ] Add integration tests for insert and replace behaviour.

## Diagnostics

- [ ] Cover same-namespace class when cache has multiple entries.
- [ ] Cover global classes.
- [ ] Cover lowercase aliases.
- [ ] Cover heredoc/string/comment false positives in diagnostics.
- [ ] Cover config toggles: `highlightNotImported`, `highlightNotUsed`, `ignoreList`.

## Save Hooks

- [ ] Verify save hook order: autoImport -> removeUnused -> sort.
- [ ] Replace imported FQCNs during auto-import-on-save.
- [ ] Add integration coverage for save hooks.

## Docs And Release

- [ ] Sync README with final behaviour.
- [ ] Finalize package metadata and marketplace assets.
- [ ] Verify full CI on GitHub Actions.
