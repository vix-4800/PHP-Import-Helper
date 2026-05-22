# PHP Import Helper

VS Code extension for PHP imports and namespaces.

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

## Settings

```jsonc
{
    "phpImportHelper.exclude": "**/node_modules/**",
    "phpImportHelper.autoSort": true,
    "phpImportHelper.autoFoldUses": false,
    "phpImportHelper.sortOnSave": false,
    "phpImportHelper.sortMode": "natural",
    "phpImportHelper.leadingSeparator": true,
    "phpImportHelper.removeOnSave": false,
    "phpImportHelper.autoImportOnSave": false,
    "phpImportHelper.ignoreList": [],
    "phpImportHelper.highlightNotImported": true,
    "phpImportHelper.highlightNotUsed": true
}
```
