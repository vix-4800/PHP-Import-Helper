declare function require(name: string): unknown;

export class PhpAstParser {
    private readonly engine: { parseCode: (code: string, filename?: string) => unknown };

    public constructor() {
        const Parser = require('php-parser') as {
            Engine: new (options: unknown) => {
                parseCode: (code: string, filename?: string) => unknown;
            };
        };

        this.engine = new Parser.Engine({
            parser: { extractDoc: true, php7: true, suppressErrors: true },
            ast: { withPositions: true },
        });
    }

    public parse(code: string, filename = 'document.php'): unknown {
        return this.engine.parseCode(code, filename);
    }
}
