import type * as vscode from 'vscode';
import type { DeclarationParser } from '../core/DeclarationParser';
import { ImportManager } from '../core/ImportManager';
import type { NamespaceCache } from '../core/NamespaceCache';
import type { PhpClassDetector } from '../core/PhpClassDetector';

export class AutoImportOnSave {
    private readonly importManager: ImportManager;

    public constructor(
        private readonly detector: PhpClassDetector,
        private readonly parser: DeclarationParser,
        private readonly cache: NamespaceCache
    ) {
        this.importManager = new ImportManager(parser);
    }

    public computeText(document: vscode.TextDocument): string {
        let text = document.getText();
        const imported = new Set(this.parser.getImportedClassNames(text));

        for (const className of this.detector.detectAll(text)) {
            if (imported.has(className)) {
                continue;
            }

            const resolved = this.cache.resolve(className);
            if (resolved.length === 1) {
                text = this.importManager.addImport(text, resolved[0].fqcn);
                imported.add(className);
            }
        }

        return text;
    }
}
