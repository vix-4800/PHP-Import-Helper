import type { DeclarationLines, InsertPosition } from '../types';

export function getInsertPosition(declarationLines: DeclarationLines): InsertPosition {
    const line = declarationLines.lastUseStatement
        ?? declarationLines.namespace
        ?? declarationLines.declare
        ?? declarationLines.phpTag;

    const prepend = declarationLines.lastUseStatement === null && line > 0 ? '\n' : '';
    const nextDeclarationLine = declarationLines.classDeclaration;
    const append = nextDeclarationLine !== null && nextDeclarationLine === line + 1 ? '\n\n' : '\n';

    return { line, prepend, append };
}
