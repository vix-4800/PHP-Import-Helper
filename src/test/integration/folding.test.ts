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

    test('provides separate folding ranges for separated import groups', async () => {
        const document = await createPhpDocument(`<?php

use App\\Models\\User;
use App\\Models\\Post;

use function App\\Helpers\\helper;
use function App\\Helpers\\other;

class Foo {}
`);

        const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
            'vscode.executeFoldingRangeProvider',
            document.uri,
        );

        assert.ok(ranges?.some((range) => range.start === 2 && range.end === 3));
        assert.ok(ranges?.some((range) => range.start === 5 && range.end === 6));
    });

    test('provides folding range for multiline grouped imports', async () => {
        const document = await createPhpDocument(`<?php

use App\\Models\\{
    User,
    Post,
};

class Foo {}
`);

        const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
            'vscode.executeFoldingRangeProvider',
            document.uri,
        );

        assert.ok(ranges?.some((range) => range.start === 2 && range.end === 5));
    });
});
