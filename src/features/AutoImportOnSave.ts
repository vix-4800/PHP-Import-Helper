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
        return this.computeTextForText(document.getText());
    }

    public computeTextForText(text: string): string {
        const imported = new Set(this.parser.getImportedClassNames(text));

        for (const reference of this.detector.detectFullyQualifiedPhpDocReferences(text)) {
            if (imported.has(reference.name)) {
                continue;
            }

            text = this.importManager.addImport(text, reference.rawName);
            imported.add(reference.name);
        }

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

        return this.importManager.replaceImportedFullyQualifiedClasses(text);
    }
}
