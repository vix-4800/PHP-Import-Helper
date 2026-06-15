function isPhpIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function pascalCase(value: string): string {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter((part) => part !== '')
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join('');
}

export function generateUniqueImportAlias(
    fqcn: string,
    occupiedNames: ReadonlySet<string>,
    prefixes: readonly string[]
): string {
    const parts = fqcn.replace(/^\\+/, '').split('\\');
    const className = parts.pop() ?? '';
    const occupied = new Set([...occupiedNames].map((name) => name.toLowerCase()));
    let namespacePrefix = '';

    for (const segment of parts.reverse()) {
        namespacePrefix = `${pascalCase(segment)}${namespacePrefix}`;
        const candidate = `${namespacePrefix}${className}`;
        if (isPhpIdentifier(candidate) && !occupied.has(candidate.toLowerCase())) {
            return candidate;
        }
    }

    for (const prefix of prefixes) {
        if (!isPhpIdentifier(prefix)) {
            continue;
        }

        const candidate = `${prefix}${className}`;
        if (isPhpIdentifier(candidate) && !occupied.has(candidate.toLowerCase())) {
            return candidate;
        }
    }

    let suffix = 2;
    while (occupied.has(`${className}${suffix}`.toLowerCase())) {
        suffix++;
    }

    return `${className}${suffix}`;
}
