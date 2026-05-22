import * as assert from 'assert';
import { DeclarationParser } from '../../core/DeclarationParser';
import { ImportManager } from '../../core/ImportManager';

suite('ImportManager', () => {
    const manager = new ImportManager(new DeclarationParser());

    test('inserts import after namespace', () => {
        const text = manager.addImport(`<?php

namespace App;

class Foo {}
`, 'App\\Models\\User');

        assert.ok(text.includes("namespace App;\n\nuse App\\Models\\User;\n\nclass Foo"));
    });

    test('does not duplicate existing import and replaces FQCN with alias', () => {
        const text = manager.replaceImportedFullyQualifiedClasses(`<?php

use yii\\httpclient\\Client as cl;

class Foo {
    public function run(): void {
        $client->setFormat(\\yii\\httpclient\\Client::FORMAT_JSON);
        $label = "\\yii\\httpclient\\Client::FORMAT_JSON";
    }
}
`);

        assert.ok(text.includes('cl::FORMAT_JSON'));
        assert.ok(text.includes('"\\yii\\httpclient\\Client::FORMAT_JSON"'));
    });

    test('removes unused imports while keeping PHPDoc-only usages', () => {
        const text = manager.removeUnused(`<?php

use App\\Conversation\\Model\\ConversationFieldModel;
use App\\Models\\Post;

class Foo {
    /** @var ConversationFieldModel[] */
    public array $fields = [];
}
`);

        assert.ok(text.includes('ConversationFieldModel'));
        assert.ok(!text.includes('use App\\Models\\Post;'));
    });

    test('removes only unused entries from grouped imports', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\{User, Post};

class Foo {
    public function user(): User {}
}
`);

        assert.ok(text.includes('use App\\Models\\User;'));
        assert.ok(!text.includes('Post'));
        assert.ok(!text.includes('{'));
    });

    test('preserves grouped import aliases when removing unused siblings', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\{User as AppUser, Post};

class Foo {
    public function user(): AppUser {}
}
`);

        assert.ok(text.includes('use App\\Models\\User as AppUser;'));
        assert.ok(!text.includes('Post'));
    });
});
