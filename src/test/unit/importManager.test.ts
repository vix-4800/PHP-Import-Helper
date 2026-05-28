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

    test('inserts import with alias', () => {
        const text = manager.addImport(`<?php

namespace App;

class Foo {}
`, 'Vendor\\Package\\Client', 'VendorClient');

        assert.ok(text.includes('use Vendor\\Package\\Client as VendorClient;'));
    });

    test('replaces FQCN with imported alias', () => {
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

    test('replaces FQCN constructors and PHPDoc types but not heredoc content', () => {
        const text = manager.replaceImportedFullyQualifiedClasses(`<?php

use App\\Services\\Client;

class Foo {
    /**
     * @var \\App\\Services\\Client
     */
    public function run(): void {
        $client = new \\App\\Services\\Client();
        $sql = <<<SQL
new \\App\\Services\\Client()
SQL;
    }
}
`);

        assert.ok(text.includes('new Client();'));
        assert.ok(text.includes('@var Client'));
        assert.ok(text.includes('new \\App\\Services\\Client()'));
    });

    test('replaces FQCN PHPDoc types inside shapes and generics', () => {
        const text = manager.replaceImportedFullyQualifiedClasses(`<?php

use yii\\web\\NotFoundHttpException;
use yii\\web\\Response;

class Foo {
    /**
     * @return array{response: \\yii\\web\\Response, errors?: list<\\yii\\web\\NotFoundHttpException>}
     */
    public function run() {}
}
`);

        assert.ok(text.includes('@return array{response: Response, errors?: list<NotFoundHttpException>}'));
    });

    test('replaces imported PHPDoc qualified names without leading separator', () => {
        const text = manager.replaceImportedFullyQualifiedClasses(`<?php

use backend\\models\\HelpDeskMedia;

/**
 * @var backend\\models\\HelpDeskMedia $mediaModel
 */
`);

        assert.ok(text.includes('@var HelpDeskMedia $mediaModel'));
        assert.strictEqual((text.match(/use backend\\models\\HelpDeskMedia;/g) ?? []).length, 1);
        assert.strictEqual((text.match(/backend\\models\\HelpDeskMedia/g) ?? []).length, 1);
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

    test('keeps aliased imports used only in PHPDoc', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\User as AppUser;
use App\\Models\\Post;

class Foo {
    /** @var AppUser */
    private $user;
}
`);

        assert.ok(text.includes('use App\\Models\\User as AppUser;'));
        assert.ok(!text.includes('use App\\Models\\Post;'));
    });

    test('keeps imports used as PHPDoc namespace prefixes', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\User;
use App\\Models\\Post;

class Foo {
    /** @return User\\Profile */
    public function profile() {}
}
`);

        assert.ok(text.includes('use App\\Models\\User;'));
        assert.ok(!text.includes('use App\\Models\\Post;'));
    });

    test('keeps imported built-ins used in PHPDoc and runtime code', () => {
        const text = manager.removeUnused(`<?php

use Exception;
use SplFileInfo;
use App\\Models\\Post;

class Foo {
    /**
     * @throws Exception
     */
    public function run(string $src): SplFileInfo {
        try {
            return new SplFileInfo($src);
        } catch (Exception $e) {
            throw $e;
        }
    }
}
`);

        assert.ok(text.includes('use Exception;'));
        assert.ok(text.includes('use SplFileInfo;'));
        assert.ok(!text.includes('use App\\Models\\Post;'));
    });

    test('keeps duplicate imports when duplicate cleanup is disabled', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\User;
use App\\Models\\User;

class Foo {
    public function user(User $user): User {
        return $user;
    }
}
`);

        assert.strictEqual((text.match(/use App\\Models\\User;/g) ?? []).length, 2);
    });

    test('removes duplicate imports when duplicate cleanup is enabled', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\User;
use App\\Models\\User;

class Foo {
    public function user(User $user): User {
        return $user;
    }
}
`, [], true);

        assert.strictEqual((text.match(/use App\\Models\\User;/g) ?? []).length, 1);
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
        assert.ok(!text.includes('use App\\Models\\{'));
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

    test('keeps imports used as namespace prefixes', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\User;

class Foo {
    public function profile(): User\\Profile {}
}
`);

        assert.ok(text.includes('use App\\Models\\User;'));
    });

    test('keeps lowercase alias used through static access and new expression', () => {
        const text = manager.removeUnused(`<?php

use yii\\httpclient\\Client as cl;
use App\\Models\\Post;

class Foo {
    public function run(): void {
        cl::create();
        new cl();
    }
}
`);

        assert.ok(text.includes('use yii\\httpclient\\Client as cl;'));
        assert.ok(!text.includes('use App\\Models\\Post;'));
    });

    test('keeps imported traits used inside a class body', () => {
        const text = manager.removeUnused(`<?php

use App\\Traits\\HasFactory;
use App\\Models\\Post;

class Foo {
    use HasFactory;
}
`);

        assert.ok(text.includes('use App\\Traits\\HasFactory;'));
        assert.ok(!text.includes('use App\\Models\\Post;'));
    });

    test('cleans blank lines after removing all unused imports', () => {
        const text = manager.removeUnused(`<?php

use App\\Models\\User;
use App\\Models\\Post;


class Foo {}
`);

        assert.ok(!text.includes('use App\\Models\\User;'));
        assert.ok(!text.includes('\n\n\nclass Foo'));
    });

    test('preserves ignored unused imports', () => {
        const text = manager.removeUnused(`<?php

use App\\Facades\\Yii;
use App\\Models\\Post;

class Foo {}
`, ['Yii']);

        assert.ok(text.includes('use App\\Facades\\Yii;'));
        assert.ok(!text.includes('use App\\Models\\Post;'));
    });
});
