export interface NamespaceCacheUpdateBatch<TUri> {
    changed: TUri[];
    deleted: TUri[];
}

export class NamespaceCacheUpdateQueue<TUri extends { toString: () => string }> {
    private readonly changed = new Map<string, TUri>();
    private readonly deleted = new Map<string, TUri>();

    public constructor(private readonly isIndexable: (uri: TUri) => boolean) {}

    public get size(): number {
        return this.changed.size + this.deleted.size;
    }

    public addChanged(uri: TUri): boolean {
        if (!this.isIndexable(uri)) {
            return false;
        }

        const key = uri.toString();
        const alreadyChanged = this.changed.has(key);
        const wasDeleted = this.deleted.delete(key);

        this.changed.set(key, uri);

        return !alreadyChanged || wasDeleted;
    }

    public addDeleted(uri: TUri): boolean {
        if (!this.isIndexable(uri)) {
            return false;
        }

        const key = uri.toString();
        const wasChanged = this.changed.delete(key);
        const alreadyDeleted = this.deleted.has(key);

        this.deleted.set(key, uri);

        return wasChanged || !alreadyDeleted;
    }

    public consume(): NamespaceCacheUpdateBatch<TUri> {
        const batch = {
            changed: [...this.changed.values()],
            deleted: [...this.deleted.values()],
        };

        this.changed.clear();
        this.deleted.clear();

        return batch;
    }
}
