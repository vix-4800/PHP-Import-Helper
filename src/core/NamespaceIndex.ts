import type { CacheEntry, ResolvedNamespace } from '../types';
import { PhpAstParser } from './phpParser';

type IndexedEntry = Omit<CacheEntry, 'sourceUri' | 'uri'> & {
    uri: { fsPath: string };
    sourceUri?: { fsPath: string };
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

    public toEntries(): IndexedEntry[] {
        return [...this.entries.values()].flat();
    }

    public replaceFile(uri: { fsPath: string }, entries: IndexedEntry[]): void {
        this.removeFile(uri);

        for (const entry of entries) {
            this.add(entry);
        }
    }

    public removeFile(uri: { fsPath: string }): void {
        for (const [className, entries] of this.entries) {
            const remaining = entries.filter((entry) =>
                (entry.sourceUri?.fsPath ?? entry.uri.fsPath) !== uri.fsPath
            );

            if (remaining.length === 0) {
                this.entries.delete(className);
                continue;
            }

            this.entries.set(className, remaining);
        }
    }

    public add(entry: IndexedEntry): void {
        const list = this.entries.get(entry.className) ?? [];
        if (list.some((item) => item.fqcn === entry.fqcn && item.uri.fsPath === entry.uri.fsPath)) {
            return;
        }

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
