import * as assert from 'assert';
import * as vscode from 'vscode';
import { UseFoldingRangeProvider } from '../../features/UseFoldingRangeProvider';

async function provideRanges(content: string): Promise<vscode.FoldingRange[]> {
    const document = await vscode.workspace.openTextDocument({ language: 'php', content });

    return new UseFoldingRangeProvider().provideFoldingRanges(document);
}

suite('folding provider', () => {
    test('provides folding range for top-level import block', async () => {
        const ranges = await provideRanges(`<?php

use App\\Models\\User;
use function App\\Helpers\\helper;

class Foo {}
`);

        assert.ok(ranges.some((range) => range.start === 2 && range.end === 3));
    });

    test('provides separate folding ranges for separated import groups', async () => {
        const ranges = await provideRanges(`<?php

use App\\Models\\User;
use App\\Models\\Post;

use function App\\Helpers\\helper;
use function App\\Helpers\\other;

class Foo {}
`);

        assert.ok(ranges.some((range) => range.start === 2 && range.end === 3));
        assert.ok(ranges.some((range) => range.start === 5 && range.end === 6));
    });

    test('provides folding range for multiline grouped imports', async () => {
        const ranges = await provideRanges(`<?php

use App\\Models\\{
    User,
    Post,
};

class Foo {}
`);

        assert.ok(ranges.some((range) => range.start === 2 && range.end === 5));
    });
});
