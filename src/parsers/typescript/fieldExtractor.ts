// Frontend field extraction
// Extracts fields from fetch/axios/doFetch bodies, JSON.stringify({...}), form objects

import {
  CallExpression,
  Identifier,
  ObjectLiteralExpression,
  Project, SyntaxKind,
  VariableDeclaration
} from 'ts-morph';
import { Field } from '../../types';

function collectObjectFields(
  obj: ObjectLiteralExpression,
  filePath: string,
  side: 'request' | 'response'
): Field[] {
  const fields: Field[] = [];
  for (const prop of obj.getProperties()) {
    if (
      prop.getKind() === SyntaxKind.PropertyAssignment ||
      prop.getKind() === SyntaxKind.ShorthandPropertyAssignment
    ) {
      const name = prop.getSymbol()?.getName();
      if (name) {
        fields.push({
          name,
          side,
          definedAt: `${filePath}:${prop.getStartLineNumber()}`,
          wasteScore: 0,
        });
      }
    }
  }
  return fields;
}

function resolveToObjectLiteral(
  identifier: Identifier
): ObjectLiteralExpression | null {
  const symbol = identifier.getSymbol();
  if (!symbol) return null;

  const declarations = symbol.getDeclarations();
  if (declarations.length !== 1) return null;

  const decl = declarations[0];
  if (decl.getKind() !== SyntaxKind.VariableDeclaration) return null;

  const init = (decl as VariableDeclaration).getInitializer();
  if (!init || init.getKind() !== SyntaxKind.ObjectLiteralExpression) return null;

  return init.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

function extractFromOptionsObject(
  call: CallExpression,
  filePath: string
): Field[] {
  const args = call.getArguments();
  const lastArg = args[args.length - 1];
  if (!lastArg || lastArg.getKind() !== SyntaxKind.ObjectLiteralExpression) return [];

  const opts = lastArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);

  const methodProp = opts.getProperty('method');
  if (!methodProp || methodProp.getKind() !== SyntaxKind.PropertyAssignment) return [];
  const methodVal = methodProp
    .asKindOrThrow(SyntaxKind.PropertyAssignment)
    .getInitializer()?.getText().replace(/['"` ]/g, '').toLowerCase();
  if (!methodVal || !['post', 'put', 'patch', 'delete'].includes(methodVal)) return [];

  const bodyProp = opts.getProperty('body');
  if (!bodyProp || bodyProp.getKind() !== SyntaxKind.PropertyAssignment) return [];
  const bodyInit = bodyProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (!bodyInit || bodyInit.getKind() !== SyntaxKind.CallExpression) return [];

  const bodyCall = bodyInit.asKindOrThrow(SyntaxKind.CallExpression);
  if (bodyCall.getExpression().getText() !== 'JSON.stringify') return [];

  const innerArgs = bodyCall.getArguments();
  if (innerArgs.length < 1) return [];

  const arg = innerArgs[0];

  // Case A: inline object literal
  if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
    return collectObjectFields(
      arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
      filePath, 'request'
    );
  }

  // Case B: single-hop variable reference
  if (arg.getKind() === SyntaxKind.Identifier) {
    const obj = resolveToObjectLiteral(arg.asKindOrThrow(SyntaxKind.Identifier));
    if (obj) return collectObjectFields(obj, filePath, 'request');
  }

  return [];
}

// Extract request body fields from a TypeScript/JavaScript source file.
export function extractFields(filePath: string, project?: Project): Field[] {
  const proj = project ?? new Project({ skipLoadingLibFiles: true } as any);
  if (!proj.getSourceFile(filePath)) {
    proj.addSourceFileAtPath(filePath);
  }
  const sourceFile = proj.getSourceFileOrThrow(filePath);
  const fields: Field[] = [];

  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
    const expr = call.getExpression().getText();

    // ── Rule 1: axios.post/put/patch(url, { field1, field2 }) ────────────────
    if (/^axios\.(post|put|patch)$/.test(expr)) {
      const args = call.getArguments();
      if (args.length >= 2 && args[1].getKind() === SyntaxKind.ObjectLiteralExpression) {
        fields.push(...collectObjectFields(
          args[1].asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
          filePath, 'request'
        ));
      }
    }

    // ── Rule 2: any call with { method: 'post'|..., body: JSON.stringify(X) }
    //           covers fetch(), this.doFetch(), this.doFetchWithResponse(), etc.
    const extracted = extractFromOptionsObject(call, filePath);
    if (extracted.length > 0) fields.push(...extracted);

    // ── Rule 3: standalone JSON.stringify({ ... }) not inside a body: property
    if (expr === 'JSON.stringify') {
      const parent = call.getParent();
      const isInsideBodyProp =
        parent?.getKind() === SyntaxKind.PropertyAssignment &&
        parent.asKind(SyntaxKind.PropertyAssignment)?.getName() === 'body';
      if (!isInsideBodyProp) {
        const args = call.getArguments();
        if (args.length >= 1 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
          fields.push(...collectObjectFields(
            args[0].asKindOrThrow(SyntaxKind.ObjectLiteralExpression),
            filePath, 'request'
          ));
        }
      }
    }
  });

  const seen = new Set<string>();
  return fields.filter(f => {
    const key = `${f.name}:${f.definedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
