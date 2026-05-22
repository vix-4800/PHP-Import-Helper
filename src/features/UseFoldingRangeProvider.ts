import * as vscode from 'vscode';
import { UseFoldingRangeCalculator } from '../core/UseFoldingRangeCalculator';

export class UseFoldingRangeProvider implements vscode.FoldingRangeProvider {
    private readonly calculator = new UseFoldingRangeCalculator();

    public provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        return this.calculator
            .calculate(document.getText().split(/\r?\n/))
            .map(
                (range) =>
                    new vscode.FoldingRange(
                        range.startLine,
                        range.endLine,
                        vscode.FoldingRangeKind.Imports
                    )
            );
    }
}
