import * as assert from 'assert';
import * as vscode from 'vscode';
import { getText, openWorkspaceFile, wait } from './helper';

suite('save hooks', () => {
    test('applies auto import before remove unused and sort on save', async () => {
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previousAutoImport = config.get<boolean>('autoImportOnSave', false);
        const previousRemove = config.get<boolean>('removeOnSave', false);
        const previousSort = config.get<boolean>('sortOnSave', false);

        try {
            await config.update('autoImportOnSave', true, vscode.ConfigurationTarget.Global);
            await config.update('removeOnSave', true, vscode.ConfigurationTarget.Global);
            await config.update('sortOnSave', true, vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
                {
                    className: 'Request',
                    fqcn: 'App\\Http\\Request',
                    uri: vscode.Uri.file('/project/app/Http/Request.php'),
                },
            ]);

            const editor = await openWorkspaceFile('save-hooks/Controller.php', `<?php

use yii\\httpclient\\Client as cl;
use App\\Zed;
use App\\Models\\Post;

class Controller {
    public function show(Request $request): Zed {
        return new \\yii\\httpclient\\Client();
    }
}
`);

            await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
            await editor.document.save();
            await wait(300);

            const text = getText(editor);

            assert.ok(text.includes('use App\\Http\\Request;'));
            assert.ok(text.includes('use App\\Zed;'));
            assert.ok(!text.includes('use App\\Models\\Post;'));
            assert.ok(text.includes('new cl()'));
            assert.ok(text.indexOf('use App\\Http\\Request;') < text.indexOf('use App\\Zed;'));
        } finally {
            await config.update('autoImportOnSave', previousAutoImport, vscode.ConfigurationTarget.Global);
            await config.update('removeOnSave', previousRemove, vscode.ConfigurationTarget.Global);
            await config.update('sortOnSave', previousSort, vscode.ConfigurationTarget.Global);
        }
    });

    test('keeps aliased PHPDoc-only imports on remove-on-save', async () => {
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previousRemove = config.get<boolean>('removeOnSave', false);

        try {
            await config.update('removeOnSave', true, vscode.ConfigurationTarget.Global);

            const editor = await openWorkspaceFile('save-hooks/DocblockAlias.php', `<?php

use App\\Models\\User as AppUser;
use App\\Models\\Post;

class Controller {
    /** @var AppUser */
    private $user;
}
`);

            await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
            await editor.document.save();
            await wait(300);

            const text = getText(editor);

            assert.ok(text.includes('use App\\Models\\User as AppUser;'));
            assert.ok(!text.includes('use App\\Models\\Post;'));
        } finally {
            await config.update('removeOnSave', previousRemove, vscode.ConfigurationTarget.Global);
        }
    });

    test('auto import on save imports fully qualified PHPDoc types', async () => {
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previousAutoImport = config.get<boolean>('autoImportOnSave', false);

        try {
            await config.update('autoImportOnSave', true, vscode.ConfigurationTarget.Global);

            const editor = await openWorkspaceFile('save-hooks/DocblockFqcn.php', `<?php

class Controller {
    /**
     * @return string|\\yii\\web\\Response
     * @throws \\yii\\web\\NotFoundHttpException if the model cannot be found
     */
    public function run() {}
}
`);

            await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
            await editor.document.save();
            await wait(300);

            const text = getText(editor);

            assert.ok(text.includes('use yii\\web\\NotFoundHttpException;'));
            assert.ok(text.includes('use yii\\web\\Response;'));
            assert.ok(text.includes('@return string|Response'));
            assert.ok(text.includes('@throws NotFoundHttpException if the model cannot be found'));
        } finally {
            await config.update('autoImportOnSave', previousAutoImport, vscode.ConfigurationTarget.Global);
        }
    });

    test('auto import on save imports fully qualified PHPDoc types inside shapes and generics', async () => {
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previousAutoImport = config.get<boolean>('autoImportOnSave', false);

        try {
            await config.update('autoImportOnSave', true, vscode.ConfigurationTarget.Global);

            const editor = await openWorkspaceFile('save-hooks/DocblockComplexFqcn.php', `<?php

class Controller {
    /**
     * @return array{response: \\yii\\web\\Response, errors?: list<\\yii\\web\\NotFoundHttpException>}
     */
    public function run() {}
}
`);

            await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
            await editor.document.save();
            await wait(300);

            const text = getText(editor);

            assert.ok(text.includes('use yii\\web\\NotFoundHttpException;'));
            assert.ok(text.includes('use yii\\web\\Response;'));
            assert.ok(text.includes('@return array{response: Response, errors?: list<NotFoundHttpException>}'));
        } finally {
            await config.update('autoImportOnSave', previousAutoImport, vscode.ConfigurationTarget.Global);
        }
    });

    test('auto import on save skips same-namespace classes', async () => {
        const config = vscode.workspace.getConfiguration('phpImportHelper');
        const previousAutoImport = config.get<boolean>('autoImportOnSave', false);

        try {
            await config.update('autoImportOnSave', true, vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('phpImportHelper.rebuildIndex', [
                {
                    className: 'FeatureBase',
                    fqcn: 'App\\Feature\\FeatureBase',
                    uri: vscode.Uri.file('/project/app/Feature/FeatureBase.php'),
                },
            ]);

            const editor = await openWorkspaceFile('save-hooks/SameNamespace.php', `<?php

namespace App\\Feature;

abstract class FeatureController extends FeatureBase {}
`);

            await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), '\n'));
            await editor.document.save();
            await wait(300);

            assert.ok(!getText(editor).includes('use App\\Feature\\FeatureBase;'));
        } finally {
            await config.update('autoImportOnSave', previousAutoImport, vscode.ConfigurationTarget.Global);
        }
    });
});
