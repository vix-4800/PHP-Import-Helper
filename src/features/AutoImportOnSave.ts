import type * as vscode from 'vscode';
import type { DeclarationParser } from '../core/DeclarationParser';
import type { NamespaceCache } from '../core/NamespaceCache';
import { computeImportAllText } from '../core/importAllText';
import type { PhpClassDetector } from '../core/PhpClassDetector';

export class AutoImportOnSave {
    public constructor(
        private readonly detector: PhpClassDetector,
        private readonly parser: DeclarationParser,
        private readonly cache: NamespaceCache
    ) {}

    public computeText(document: vscode.TextDocument): string {
        return this.computeTextForText(document.getText());
    }

    public computeTextForText(text: string): string {
        return computeImportAllText(text, this.parser, this.detector, this.cache);
    }
}
