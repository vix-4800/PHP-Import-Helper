import * as assert from 'assert';
import { UseFoldingRangeCalculator } from '../../core/UseFoldingRangeCalculator';

suite('UseFoldingRangeCalculator', () => {
    const calculator = new UseFoldingRangeCalculator();

    test('folds adjacent top-level class function and const imports', () => {
        assert.deepStrictEqual(calculator.calculate([
            '<?php',
            '',
            'namespace App;',
            '',
            'use App\\Models\\User;',
            'use function App\\Helpers\\helper;',
            'use const App\\Config\\VERSION;',
            '',
            'class Foo {}',
        ]), [{ startLine: 4, endLine: 6 }]);
    });

    test('ignores closure use and trait use inside class body', () => {
        assert.deepStrictEqual(calculator.calculate([
            '<?php',
            '$fn = function () use ($value) { return $value; };',
            'class Foo {',
            '    use HasFactory;',
            '}',
        ]), []);
    });

    test('folds separate import groups independently', () => {
        assert.deepStrictEqual(calculator.calculate([
            '<?php',
            '',
            'use App\\Models\\User;',
            'use App\\Models\\Post;',
            '',
            'use function App\\Support\\helper;',
            'use function App\\Support\\other;',
            '',
            'class Foo {}',
        ]), [
            { startLine: 2, endLine: 3 },
            { startLine: 5, endLine: 6 },
        ]);
    });

    test('folds multiline grouped imports by declaration range', () => {
        assert.deepStrictEqual(calculator.calculate([
            '<?php',
            '',
            'use App\\Models\\{',
            '    User,',
            '    Post,',
            '};',
            '',
            'class Foo {}',
        ]), [
            { startLine: 2, endLine: 5 },
        ]);
    });
});
