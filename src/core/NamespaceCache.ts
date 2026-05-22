import * as vscode from 'vscode';
import { DeclarationParser } from './DeclarationParser';
import { NamespaceIndex } from './NamespaceIndex';
import type { CacheEntry, ResolvedNamespace } from '../types';

export class NamespaceCache {
    private readonly index = new NamespaceIndex();
    private readonly parser = new DeclarationParser();

    public setEntries(entries: CacheEntry[]): void {
        this.index.setEntries(entries);
    }

    public add(entry: CacheEntry): void {
        this.index.add(entry);
    }

    public lookup(className: string): CacheEntry[] {
        return this.index.lookup(className) as CacheEntry[];
    }

    public resolve(className: string): ResolvedNamespace[] {
        return this.index.resolve(className);
    }

    public async rebuild(fixtures?: CacheEntry[]): Promise<void> {
        if (fixtures !== undefined) {
            this.setEntries(fixtures);
            return;
        }

        this.index.clear();

        const files = await vscode.workspace.findFiles('**/*.php', '**/{vendor,node_modules}/**');

        for (const uri of files) {
            const document = await vscode.workspace.openTextDocument(uri);
            const parsed = this.parser.parse(document.getText());

            for (const className of parsed.declaredClassNames) {
                const fqcn =
                    parsed.namespace === null ? className : `${parsed.namespace}\\${className}`;
                this.add({ fqcn, className, uri });
            }
        }
    }
}
