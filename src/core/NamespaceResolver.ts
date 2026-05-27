import { builtInClasses } from './builtInClasses';
import { NamespaceIndex } from './NamespaceIndex';
import type { ResolvedNamespace } from '../types';

interface UriLike {
    fsPath: string;
}

interface CacheLike {
    resolve: (className: string) => ResolvedNamespace[];
}

interface NamespaceResolverWorkspace {
    findClassFiles: (className: string, activeUri?: UriLike) => Promise<UriLike[]>;
    readFile: (uri: UriLike) => Promise<string>;
}

type NegativeLookup = {
    time: number;
};

export class NamespaceResolver {
    private static readonly negativeLookupTtlMs = 60_000;
    private readonly negativeLookupCache = new Map<string, NegativeLookup>();

    public constructor(
        private readonly cache: CacheLike,
        private readonly workspace: NamespaceResolverWorkspace
    ) {}

    public clearNegativeLookups(): void {
        this.negativeLookupCache.clear();
    }

    public async resolve(className: string, activeUri?: UriLike): Promise<ResolvedNamespace[]> {
        if (builtInClasses.has(className)) {
            return [{
                fqcn: className,
                source: 'global',
                uri: { fsPath: '' } as ResolvedNamespace['uri'],
            }];
        }

        const cached = this.cache.resolve(className);
        if (cached.length > 0) {
            return cached;
        }

        const cacheKey = this.negativeLookupKey(className, activeUri);
        const negativeLookup = this.negativeLookupCache.get(cacheKey);

        if (
            negativeLookup !== undefined &&
            Date.now() - negativeLookup.time < NamespaceResolver.negativeLookupTtlMs
        ) {
            return [];
        }

        const files = await this.workspace.findClassFiles(className, activeUri);
        const resolved: ResolvedNamespace[] = [];
        const seen = new Set<string>();

        for (const uri of files) {
            if (this.basename(uri.fsPath) !== `${className}.php`) {
                continue;
            }

            let text: string;
            try {
                text = await this.workspace.readFile(uri);
            } catch {
                continue;
            }

            for (const entry of NamespaceIndex.entriesFromPhpFile(uri, text)) {
                if (entry.className !== className || seen.has(entry.fqcn)) {
                    continue;
                }

                seen.add(entry.fqcn);
                resolved.push({
                    fqcn: entry.fqcn,
                    source: entry.fqcn.includes('\\') ? this.sourceFor(uri) : 'global',
                    uri: uri as ResolvedNamespace['uri'],
                });
            }
        }

        if (resolved.length === 0) {
            this.negativeLookupCache.set(cacheKey, { time: Date.now() });
        } else {
            this.negativeLookupCache.delete(cacheKey);
        }

        return resolved;
    }

    private negativeLookupKey(className: string, activeUri?: UriLike): string {
        return `${activeUri?.fsPath ?? ''}::${className}`;
    }

    private basename(filePath: string): string {
        return filePath.replace(/\\/g, '/').split('/').pop() ?? '';
    }

    private sourceFor(uri: UriLike): ResolvedNamespace['source'] {
        return uri.fsPath.replace(/\\/g, '/').includes('/vendor/') ? 'vendor' : 'project';
    }
}
