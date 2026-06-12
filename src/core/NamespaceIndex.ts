import type { CacheEntry, ResolvedNamespace } from '../types';
import { PhpAstParser } from './phpParser';

type IndexedEntry = Omit<CacheEntry, 'uri'> & {
    uri: { fsPath: string };
};

export class NamespaceIndex {
    private readonly byClassName = new Map<string, IndexedEntry[]>();
    private readonly byUri = new Map<string, IndexedEntry[]>();
    private static readonly parser = new PhpAstParser();

    public static entriesFromPhpFile(uri: { fsPath: string }, text: string): IndexedEntry[] {
        const document = this.parser.parse(text, uri.fsPath);
        const entries: IndexedEntry[] = [];

        for (const node of document.program.children) {
            const namespace = node.kind === 'namespace' && 'name' in node
                ? typeof node.name === 'string' ? node.name : null
                : null;
            const statements = node.kind === 'namespace' && 'children' in node &&
                Array.isArray(node.children)
                ? node.children
                : [node];

            for (const statement of statements) {
                if (
                    typeof statement !== 'object' ||
                    statement === null ||
                    !('kind' in statement) ||
                    !['class', 'interface', 'trait', 'enum'].includes(String(statement.kind))
                ) {
                    continue;
                }

                const name = 'name' in statement ? statement.name : null;
                if (
                    typeof name !== 'object' ||
                    name === null ||
                    !('name' in name) ||
                    typeof name.name !== 'string'
                ) {
                    continue;
                }

                entries.push({
                    className: name.name,
                    fqcn: namespace === null ? name.name : `${namespace}\\${name.name}`,
                    uri,
                });
            }
        }

        return entries;
    }

    public setEntries(entries: IndexedEntry[]): void {
        this.clear();

        for (const entry of entries) {
            this.add(entry);
        }
    }

    public toEntries(): IndexedEntry[] {
        return [...this.byClassName.values()].flat();
    }

    public replaceFile(uri: { fsPath: string }, entries: IndexedEntry[]): void {
        this.removeFile(uri);

        for (const entry of entries) {
            this.add(entry);
        }
    }

    public removeFile(uri: { fsPath: string }): void {
        const entries = this.byUri.get(uri.fsPath);
        if (entries === undefined) {
            return;
        }

        for (const entry of entries) {
            const classEntries = this.byClassName.get(entry.className) ?? [];
            const remaining = classEntries.filter((candidate) =>
                candidate.uri.fsPath !== uri.fsPath
            );
            if (remaining.length === 0) {
                this.byClassName.delete(entry.className);
                continue;
            }

            this.byClassName.set(entry.className, remaining);
        }

        this.byUri.delete(uri.fsPath);
    }

    public add(entry: IndexedEntry): void {
        const classEntries = this.byClassName.get(entry.className) ?? [];
        classEntries.push(entry);
        this.byClassName.set(entry.className, classEntries);

        const uriEntries = this.byUri.get(entry.uri.fsPath) ?? [];
        uriEntries.push(entry);
        this.byUri.set(entry.uri.fsPath, uriEntries);
    }

    public lookup(className: string): IndexedEntry[] {
        return this.byClassName.get(className) ?? [];
    }

    public resolve(className: string): ResolvedNamespace[] {
        return this.lookup(className).map((entry) => ({
            fqcn: entry.fqcn,
            source: this.sourceFor(entry),
            uri: entry.uri as CacheEntry['uri'],
        }));
    }

    public clear(): void {
        this.byClassName.clear();
        this.byUri.clear();
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
