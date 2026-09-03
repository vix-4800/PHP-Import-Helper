# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-09-03

### Fixed

- Fixed automatic class-case correction for classes resolved from the current namespace.

## [0.5.0] - 2026-09-03

## Added

- Added case-insensitive PHP class import resolution and the `phpImportHelper.autoFixCase` setting to normalize imports and usages when importing classes.

### Fixed

- Fixed PHPStan conditional return types so imports in conditional branches are detected.
- Fixed `@phpstan-type` aliases being reported as missing imports and their references as unused imports.

## [0.4.3] - 2026-08-28

### Fixed

- Fixed false missing-import diagnostics for PHPDoc resource and PHPStan/Psalm pseudo-types.
- Fixed false missing-import diagnostics for PHPDoc generic template parameters.

## [0.4.2] - 2026-08-11

### Fixed

- Fixed false missing-import diagnostics for asymmetric visibility modifiers on promoted constructor properties.
- Fixed manual and automatic import folding without replacing or racing VS Code folding providers.

## [0.4.1] - 2026-06-19

### Fixed

- Fixed automatic alias generation so every unimported fully qualified class in a short-name conflict group receives an alias.

## [0.4.0] - 2026-06-19

### Added

- Added experimental automatic alias generation for conflicting fully qualified classes in import-all and auto-import-on-save flows.
- Added `phpImportHelper.autoAliasConflicts` and `phpImportHelper.autoAliasPrefixes` settings.

### Changed

- Replaced framework-specific test fixtures with neutral examples.

### Fixed

- Fixed ordinary block comments being parsed as PHPDoc import references.
- Fixed PHPDoc type tag descriptions being parsed as missing class imports.
- Fixed import folding so PHP language-server folding ranges remain available.
- Fixed progressive extension-host slowdown after large Git branch switches by bounding watcher performance statistics.
- Fixed overlapping persisted namespace-index writes during repeated large file-change batches.

## [0.3.0] - 2026-06-16

### Added

- Added `phpImportHelper.resolve.exclude` to configure on-demand class resolution separately from background indexing.
- Added on-demand vendor resolution to import, expand, import-all, and auto-import-on-save flows.
- Added a bundled namespace index worker for PHP parsing and persisted-index JSON work.

### Changed

- Improved namespace index updates by tracking entries by both class name and source file.
- Applied workspace-folder-specific exclusion settings during indexing and class resolution.
- Changed namespace cache startup to publish persisted indexes immediately and reconcile them in the background.
- Changed namespace cache persistence to use delayed writes after in-memory updates.

### Fixed

- Fixed classes in excluded `vendor` directories not being available for imports.
- Fixed indexing of PHP files containing multiple namespace blocks.
- Fixed PHP watcher registration being delayed until after initial index reconciliation.

## [0.2.4] - 2026-06-13

### Fixed

- Fixed auto import on save for global PHP scripts so namespace-qualified PHPDoc types are imported and shortened.

## [0.2.3] - 2026-06-05

### Fixed

- Fixed diagnostics for files without namespaces so unresolved root namespace runtime references are not reported as missing imports.

## [0.2.2] - 2026-06-02

### Fixed

- Fixed PHPDoc `@param` parsing so descriptions after variadic or by-reference variables are not treated as class imports.
- Fixed PHP 8.4 asymmetric visibility parsing so `private(set)` and `protected(set)` modifiers on typed properties are not reported as missing class imports.
- Fixed PHPDoc `@see` parsing so relative documentation paths like `guides/access-control.md` are not reported as missing class imports.

## [0.2.1] - 2026-05-31

### Fixed

- Fixed PHPDoc `@see` URL parsing so links are not reported as missing class imports.
- Fixed diagnostics for PHP files without namespaces so qualified runtime references are not reported as missing imports.

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
