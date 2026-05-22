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
});
