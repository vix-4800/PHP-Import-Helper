import * as assert from 'assert';
import { DeclarationParser } from '../../core/DeclarationParser';
import { SortManager } from '../../core/SortManager';

suite('SortManager', () => {
    const parser = new DeclarationParser();
    const sorter = new SortManager(parser);

    test('sorts class, function, and const imports in separate groups', () => {
        const document = `<?php

use const App\\Config\\VERSION;
use function App\\Helpers\\helper;
use App\\Handler10;
use App\\Handler2;

class Foo {}
`;

        const text = sorter.sortText(document, 'natural');

        assert.ok(text.includes('use App\\Handler2;\nuse App\\Handler10;\n\nuse function App\\Helpers\\helper;\n\nuse const App\\Config\\VERSION;'));
    });

    test('throws when fewer than two imports exist', () => {
        assert.throws(() => sorter.sortText("<?php\n\nuse App\\User;\n\nclass Foo {}\n", 'length'), /Nothing to sort/);
    });

    test('collapses grouped imports when sorting kept statements', () => {
        const document = `<?php

use App\\Models\\{User, Post};
use Illuminate\\Http\\Request;

class Foo {}
`;

        const text = sorter.sortText(document, 'alphabetical');

        assert.ok(text.includes('use App\\Models\\Post;'));
        assert.ok(text.includes('use App\\Models\\User;'));
        assert.ok(!text.includes('use App\\Models\\{'));
    });
});
