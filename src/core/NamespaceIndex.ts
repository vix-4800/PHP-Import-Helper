import type { CacheEntry, ResolvedNamespace } from '../types';

type IndexedEntry = Omit<CacheEntry, 'uri'> & {
    uri: { fsPath: string };
};

export class NamespaceIndex {
    private readonly entries = new Map<string, IndexedEntry[]>();

    public static entriesFromPhpFile(uri: { fsPath: string }, text: string): IndexedEntry[] {
        const namespace = /^\s*namespace\s+([^;]+);/m.exec(text)?.[1].trim() ?? null;
        const declarations = [
            ...text.matchAll(
                /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm
            ),
        ].map((match) => match[1]);

        return declarations.map((className) => ({
            className,
            fqcn: namespace === null ? className : `${namespace}\\${className}`,
            uri,
        }));
    }

    public setEntries(entries: IndexedEntry[]): void {
        this.entries.clear();

        for (const entry of entries) {
            this.add(entry);
        }
    }

    public add(entry: IndexedEntry): void {
        const list = this.entries.get(entry.className) ?? [];
        list.push(entry);
        this.entries.set(entry.className, list);
    }

    public lookup(className: string): IndexedEntry[] {
        return this.entries.get(className) ?? [];
    }

    public resolve(className: string): ResolvedNamespace[] {
        return this.lookup(className).map((entry) => ({
            fqcn: entry.fqcn,
            source: this.sourceFor(entry),
            uri: entry.uri as CacheEntry['uri'],
        }));
    }

    public clear(): void {
        this.entries.clear();
    }

    private sourceFor(entry: IndexedEntry): ResolvedNamespace['source'] {
        if (!entry.fqcn.includes('\\')) {
            return 'global';
        }

        return entry.uri.fsPath.includes('/vendor/') || entry.uri.fsPath.includes('\\vendor\\')
            ? 'vendor'
            : 'project';
    }
}
