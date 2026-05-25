export interface ClassTarget {
    rawName: string;
    className: string;
    fqcn: string | null;
}

export function parseClassTarget(rawName: string): ClassTarget | null {
    const normalizedRaw = rawName.trim();
    const normalized = normalizedRaw.replace(/^\\+/, '');
    const className = normalized.split('\\').pop() ?? '';

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(className)) {
        return null;
    }

    return {
        rawName: normalizedRaw,
        className,
        fqcn: normalized.includes('\\') ? normalized : null,
    };
}
