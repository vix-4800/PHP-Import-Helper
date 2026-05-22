import * as assert from 'assert';
import { builtInClasses } from '../../core/builtInClasses';

suite('builtInClasses', () => {
    test('contains PHP core and modern built-ins but not user-space framework classes', () => {
        for (const className of ['stdClass', 'Exception', 'DateTime', 'PDO', 'WeakMap', 'Fiber', 'BackedEnum', 'Override']) {
            assert.ok(builtInClasses.has(className), className);
        }

        assert.ok(!builtInClasses.has('Controller'));
        assert.ok(!builtInClasses.has('Request'));
    });
});
