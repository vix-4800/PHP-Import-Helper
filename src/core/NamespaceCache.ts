import * as vscode from 'vscode';
import { DeclarationParser } from './DeclarationParser';
import type { CacheEntry, ResolvedNamespace } from '../types';

export class NamespaceCache {
    private readonly entries = new Map<string, CacheEntry[]>();
    private readonly parser = new DeclarationParser();

    public setEntries(entries: CacheEntry[]): void {
        this.entries.clear();

        for (const entry of entries) {
            this.add(entry);
        }
    }

    public add(entry: CacheEntry): void {
        const list = this.entries.get(entry.className) ?? [];
        list.push(entry);
        this.entries.set(entry.className, list);
    }

    public lookup(className: string): CacheEntry[] {
        return this.entries.get(className) ?? [];
    }

    public resolve(className: string): ResolvedNamespace[] {
        return this.lookup(className).map((entry) => ({
            fqcn: entry.fqcn,
            source: entry.fqcn.includes('\\') ? 'project' : 'global',
            uri: entry.uri,
        }));
    }

    public async rebuild(fixtures?: CacheEntry[]): Promise<void> {
        if (fixtures !== undefined) {
            this.setEntries(fixtures);
            return;
        }

        this.entries.clear();

        const files = await vscode.workspace.findFiles('**/*.php', '**/{vendor,node_modules}/**');

        for (const uri of files) {
            const document = await vscode.workspace.openTextDocument(uri);
            const parsed = this.parser.parse(document.getText());

            for (const className of parsed.declaredClassNames) {
                const fqcn = parsed.namespace === null ? className : `${parsed.namespace}\\${className}`;
                this.add({ fqcn, className, uri });
            }
        }
    }
}
