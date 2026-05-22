import type { CacheEntry, ResolvedNamespace } from '../types';
import { PhpAstParser } from './phpParser';

type IndexedEntry = Omit<CacheEntry, 'uri'> & {
    uri: { fsPath: string };
};

export class NamespaceIndex {
    private readonly entries = new Map<string, IndexedEntry[]>();
    private static readonly parser = new PhpAstParser();

    public static entriesFromPhpFile(uri: { fsPath: string }, text: string): IndexedEntry[] {
        const document = this.parser.parse(text, uri.fsPath);
        const namespace = this.parser.getNamespace(document)?.name ?? null;
        const declarations = this.parser
            .getTopLevelStatements(document)
            .filter((node) => ['class', 'interface', 'trait', 'enum'].includes(node.kind))
            .map((node) => {
                const name = node.name;

                return typeof name === 'object' &&
                    name !== null &&
                    'name' in name &&
                    typeof (name as { name: unknown }).name === 'string'
                    ? (name as { name: string }).name
                    : '';
            })
            .filter((name) => name !== '');

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
