# PHP Import Helper

[![Version](https://vsmarketplacebadges.dev/version/vix.php-import-helper.svg)](https://marketplace.visualstudio.com/items?itemName=vix.php-import-helper)
[![Installs](https://vsmarketplacebadges.dev/installs-short/vix.php-import-helper.svg)](https://marketplace.visualstudio.com/items?itemName=vix.php-import-helper)
[![Rating](https://vsmarketplacebadges.dev/rating-short/vix.php-import-helper.svg)](https://marketplace.visualstudio.com/items?itemName=vix.php-import-helper)
![License](https://img.shields.io/github/license/vix-4800/php-import-helper)

VS Code extension for PHP imports and namespaces. It resolves classes from the workspace, adds and expands imports, sorts and folds `use` blocks, removes unused imports, generates namespaces from Composer autoload config, and reports import diagnostics.

![banner](banner.png)

## Features

- Import one class from the cursor or diagnostic quick fix.
- Import all uniquely resolved classes in the active PHP file.
- Expand a short class name to a fully qualified class name.
- Sort imports by natural order, length, or alphabetically.
- Fold top-level import blocks, including grouped, function, and const imports.
- Remove unused class imports while preserving PHPDoc-only usages, aliases, traits, and namespace-prefix usages.
- Generate namespaces from the nearest `composer.json` PSR-4/PSR-0 mapping.
- Highlight unimported classes and unused imports with quick fixes.
- Cache namespace indexes from Composer autoload roots and generated vendor class maps.

## Commands

| Command | Title |
| --- | --- |
| `phpImportHelper.import` | Import Class |
| `phpImportHelper.importAll` | Import All Classes |
| `phpImportHelper.expand` | Expand Class |
| `phpImportHelper.sort` | Sort Imports |
| `phpImportHelper.foldUses` | Fold Imports |
| `phpImportHelper.removeUnused` | Remove Unused Imports |
| `phpImportHelper.generateNamespace` | Generate Namespace |
| `phpImportHelper.rebuildIndex` | Rebuild Namespace Index |
| `phpImportHelper.showPerformanceStats` | Show Performance Stats |

## Settings

```jsonc
{
    "phpImportHelper.index.exclude": [
        "**/.git/**",
        "**/node_modules/**",
        "**/vendor/**",
        "**/var/cache/**",
        "**/runtime/**",
        "**/storage/framework/**",
        "**/bootstrap/cache/**"
    ],
    "phpImportHelper.autoSort": true,
    "phpImportHelper.autoFoldUses": false,
    "phpImportHelper.sortOnSave": false,
    "phpImportHelper.sortMode": "natural",
    "phpImportHelper.leadingSeparator": true,
    "phpImportHelper.removeOnSave": false,
    "phpImportHelper.removeDuplicateImports": false,
    "phpImportHelper.autoImportOnSave": false,
    "phpImportHelper.ignoreList": [],
    "phpImportHelper.highlightNotImported": true,
    "phpImportHelper.highlightNotUsed": true,
    "phpImportHelper.diagnostics.debounceMs": 300,
    "phpImportHelper.performance.trace": false
}
```

## Indexing

PHP Import Helper builds its namespace index from Composer metadata when a workspace has `composer.json`.
Project classes are scanned from `autoload` and `autoload-dev` PSR-4, PSR-0, and classmap roots instead of every PHP file in the workspace.
Vendor classes are read from Composer-generated `vendor/composer/autoload_classmap.php` and `vendor/composer/autoload_static.php` files.

Composer PSR-4 vendor mappings are not treated as a complete class index. For full vendor coverage, run Composer with optimized autoload/classmap output, for example `composer dump-autoload -o`. If a class is not in the index, import resolution still falls back to searching `**/<ClassName>.php` inside the active workspace folder.

## Development

```sh
npm run lint
npm run check-types
npm run package
npm run test:unit
npm run test:integration
```
