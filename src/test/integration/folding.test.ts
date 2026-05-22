import * as assert from 'assert';
import * as vscode from 'vscode';
import { createPhpDocument } from './helper';

suite('folding provider', () => {
    test('provides folding range for top-level import block', async () => {
        const document = await createPhpDocument(`<?php

use App\\Models\\User;
use function App\\Helpers\\helper;

class Foo {}
`);

        const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
            'vscode.executeFoldingRangeProvider',
            document.uri,
        );

        assert.ok(ranges?.some((range) => range.start === 2 && range.end === 3));
    });
});
