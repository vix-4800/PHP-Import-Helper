Главные недоделки:

- php-parser AST почти не используется, много regex-логики;
- cache rebuild ещё без watcher/invalidation и без multi-root scoping;
- diagnostics покрыты базово, но edge cases оригинала не все перенесены;
- auto-import-on-save слабый;
- generate namespace базовый;
- foldUses command пока не полноценный;
- import conflict/alias UX ещё минимальный;
- README/package metadata есть, но не финальные.
