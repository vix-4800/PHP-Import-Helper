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

export class NamespaceResolver {
    public constructor(
        private readonly cache: CacheLike,
        private readonly workspace: NamespaceResolverWorkspace
    ) {}

    public async resolve(className: string, activeUri?: UriLike): Promise<ResolvedNamespace[]> {
        const cached = this.cache.resolve(className);
        if (cached.length > 0) {
            return cached;
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

        return resolved;
    }

    private basename(filePath: string): string {
        return filePath.replace(/\\/g, '/').split('/').pop() ?? '';
    }

    private sourceFor(uri: UriLike): ResolvedNamespace['source'] {
        return uri.fsPath.replace(/\\/g, '/').includes('/vendor/') ? 'vendor' : 'project';
    }
}
