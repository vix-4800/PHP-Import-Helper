# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-28

### Added

- Added duplicate import diagnostics so repeated `use` statements are highlighted as errors.
- Added the `phpImportHelper.removeDuplicateImports` setting to remove repeated class imports during import cleanup.

## [0.1.1] - 2026-05-28

### Fixed

- Fixed `Import All Classes` and `autoImportOnSave` so fully qualified runtime class references are imported and shortened correctly.

## [0.1.0] - 2026-05-28

### Added

- Added a performance output channel with trace logging for diagnostics updates, index batches, and persisted cache writes.
- Added the `PHP Import Helper: Show Performance Stats` command.
- Added the `phpImportHelper.performance.trace` setting to enable performance trace output.
- Added a shared per-document diagnostics analysis cache keyed by document version.
- Added negative fallback lookup caching in namespace resolution to avoid repeated workspace searches for unresolved class names.
- Added the `phpImportHelper.index.exclude` setting for index and workspace-class-search exclusions.

### Changed

- Debounced diagnostics updates triggered by text document changes.
- Added a document version guard so diagnostics skip repeated analysis for the same document version.
- Limited cache-driven diagnostics refreshes to visible PHP editors instead of all open text documents.
- Reused a single reference detection pass to derive both import candidates and import usages in diagnostics-related flows.
- Applied index exclusion rules consistently to full index scans, watched file events, and fallback workspace file search.

### Fixed

- Reduced redundant PHP parsing and class-reference analysis in hot diagnostics paths.
- Prevented excluded PHP files from being queued by watched index updates.
- Fixed exclusion matching for paths nested under hidden intermediate directories used by the test workspace.

### Removed

- Removed the legacy `phpImportHelper.exclude` setting in favor of `phpImportHelper.index.exclude`.
