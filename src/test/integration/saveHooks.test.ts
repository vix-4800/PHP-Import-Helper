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
});
