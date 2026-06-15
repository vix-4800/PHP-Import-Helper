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
use Framework\\Http\\Request;

class Foo {}
`;

        const text = sorter.sortText(document, 'alphabetical');

        assert.ok(text.includes('use App\\Models\\Post;'));
        assert.ok(text.includes('use App\\Models\\User;'));
        assert.ok(!text.includes('use App\\Models\\{'));
    });

    test('sorts by length with alphabetical tiebreaker', () => {
        const document = `<?php

use App\\Beta;
use App\\Aard;
use App\\LongerClass;

class Foo {}
`;

        const text = sorter.sortText(document, 'length');

        assert.ok(text.indexOf('use App\\Aard;') < text.indexOf('use App\\Beta;'));
        assert.ok(text.indexOf('use App\\Beta;') < text.indexOf('use App\\LongerClass;'));
    });

    test('sorts alphabetically case-insensitively', () => {
        const document = `<?php

use App\\zeta;
use App\\Alpha;
use App\\beta;

class Foo {}
`;

        const text = sorter.sortText(document, 'alphabetical');

        assert.ok(text.indexOf('use App\\Alpha;') < text.indexOf('use App\\beta;'));
        assert.ok(text.indexOf('use App\\beta;') < text.indexOf('use App\\zeta;'));
    });

    test('preserves non-import code around sorted imports', () => {
        const document = `<?php

namespace App;

use App\\Zulu;
use App\\Alpha;

final class Foo {}
`;

        const text = sorter.sortText(document, 'alphabetical');

        assert.ok(text.startsWith('<?php\n\nnamespace App;\n\n'));
        assert.ok(text.endsWith('\nfinal class Foo {}\n'));
    });
});
