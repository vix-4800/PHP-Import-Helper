import type * as vscode from 'vscode';
import type { DeclarationParser } from '../core/DeclarationParser';
import {
    computeImportAllText,
    type NamespaceLookup,
} from '../core/importAllText';
import type { PhpClassDetector } from '../core/PhpClassDetector';

export class AutoImportOnSave {
    public constructor(
        private readonly detector: PhpClassDetector,
        private readonly parser: DeclarationParser,
        private readonly resolver: NamespaceLookup
    ) {}

    public async computeText(document: vscode.TextDocument): Promise<string> {
        return await this.computeTextForText(document.getText(), document.uri);
    }

    public async computeTextForText(
        text: string,
        activeUri?: { fsPath: string }
    ): Promise<string> {
        return await computeImportAllText(
            text,
            this.parser,
            this.detector,
            this.resolver,
            activeUri
        );
    }
}
