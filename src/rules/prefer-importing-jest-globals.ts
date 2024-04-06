import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import {
  type ParsedJestFnCall,
  createRule,
  getAccessorValue,
  getSourceCode,
  isIdentifier,
  isStringNode,
  isSupportedAccessor,
  parseJestFnCall,
} from './utils';

const createFixerImports = (isModule: boolean, functionsToImport: string[]) => {
  const allImportsFormatted = functionsToImport.join(', ');

  return isModule
    ? `import { ${allImportsFormatted} } from '@jest/globals';`
    : `const { ${allImportsFormatted} } = require('@jest/globals');`;
};

export default createRule({
  name: __filename,
  meta: {
    docs: {
      description: 'Prefer importing Jest globals',
    },
    messages: {
      preferImportingJestGlobal: `Import the following Jest functions from '@jest/globals': {{ jestFunctions }}`,
    },
    fixable: 'code',
    type: 'problem',
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const importedFunctionsWithSource: Record<string, string> = {};
    const usedJestFunctions: ParsedJestFnCall[] = [];

    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        node.specifiers.forEach(specifier => {
          if (specifier.type === 'ImportSpecifier') {
            importedFunctionsWithSource[specifier.local.name] =
              node.source.value;
          }
        });
      },
      CallExpression(node: TSESTree.CallExpression) {
        const jestFnCall = parseJestFnCall(node, context);

        if (!jestFnCall) {
          return;
        }

        usedJestFunctions.push(jestFnCall);
      },
      'Program:exit'() {
        const jestFunctionsToReport = usedJestFunctions.filter(
          jestFunction => jestFunction.head.type !== 'import',
        );

        if (!jestFunctionsToReport.length) {
          return;
        }
        const jestFunctionsToImport = Array.from(
          new Set(jestFunctionsToReport.map(jestFunction => jestFunction.name)),
        );
        const reportingNode = jestFunctionsToReport[0].head.node;

        const jestFunctionsToImportFormatted = jestFunctionsToImport.join(', ');

        const isModule = context.parserOptions.sourceType === 'module';

        context.report({
          node: reportingNode,
          messageId: 'preferImportingJestGlobal',
          data: { jestFunctions: jestFunctionsToImportFormatted },
          fix(fixer) {
            const sourceCode = getSourceCode(context);
            const [firstNode] = sourceCode.ast.body;

            // check if "use strict" directive exists
            if (
              firstNode.type === AST_NODE_TYPES.ExpressionStatement &&
              isStringNode(firstNode.expression, 'use strict')
            ) {
              return fixer.insertTextAfter(
                firstNode,
                `\n${createFixerImports(isModule, jestFunctionsToImport)}`,
              );
            }

            const importNode = sourceCode.ast.body.find(
              node =>
                node.type === AST_NODE_TYPES.ImportDeclaration &&
                node.source.value === '@jest/globals',
            );

            if (importNode?.type === AST_NODE_TYPES.ImportDeclaration) {
              const existingImports = importNode.specifiers.reduce<string[]>(
                (imports, specifier) => {
                  if (
                    specifier.type === AST_NODE_TYPES.ImportSpecifier &&
                    specifier.imported?.name
                  ) {
                    imports.push(specifier.imported.name);
                  }

                  if (
                    specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier
                  ) {
                    imports.push(specifier.local.name);
                  }

                  return imports;
                },
                [],
              );

              const allImports = [
                ...new Set([...existingImports, ...jestFunctionsToImport]),
              ];

              return fixer.replaceText(
                importNode,
                createFixerImports(isModule, allImports),
              );
            }

            const requireNode = sourceCode.ast.body.find(
              node =>
                node.type === AST_NODE_TYPES.VariableDeclaration &&
                node.declarations.some(
                  declaration =>
                    declaration.init?.type === AST_NODE_TYPES.CallExpression &&
                    isIdentifier(declaration.init.callee, 'require') &&
                    isStringNode(
                      declaration.init.arguments[0],
                      '@jest/globals',
                    ) &&
                    (declaration.id.type === AST_NODE_TYPES.Identifier ||
                      declaration.id.type === AST_NODE_TYPES.ObjectPattern),
                ),
            );

            if (requireNode?.type !== AST_NODE_TYPES.VariableDeclaration) {
              return fixer.insertTextBefore(
                reportingNode,
                `${createFixerImports(isModule, jestFunctionsToImport)}\n`,
              );
            }

            const existingImports =
              requireNode.declarations[0]?.id.type ===
              AST_NODE_TYPES.ObjectPattern
                ? requireNode.declarations[0]?.id.properties.map(property => {
                    if (
                      property.type === AST_NODE_TYPES.Property &&
                      isSupportedAccessor(property.key)
                    ) {
                      return getAccessorValue(property.key);
                    }

                    return null;
                  })
                : [];

            const allImports = [
              ...new Set([
                ...existingImports.filter((imp): imp is string => imp !== null),
                ...jestFunctionsToImport,
              ]),
            ];

            return fixer.replaceText(
              requireNode,
              `${createFixerImports(isModule, allImports)}`,
            );
          },
        });
      },
    };
  },
});
