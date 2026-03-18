// Person C — Python backend field extraction
// Extracts fields from Flask/FastAPI response objects and Pydantic models
// Uses regex (same approach as backendDetector.ts) — no tree-sitter dependency

import * as fs from 'fs';
import { Field } from '../../types';

function lineOf(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

function dedup(fields: Field[]): Field[] {
  const seen = new Set<string>();
  return fields.filter(f => {
    const key = `${f.name}:${f.definedAt}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

// Pydantic BaseModel field names to exclude
const PYTHON_MODEL_NOISE = new Set([
  'model_config', 'model_fields', 'model_computed_fields',
  'schema_extra', 'validators', 'root_validator', 'Config', 'Meta',
]);

function isNoiseName(name: string): boolean {
  if (PYTHON_MODEL_NOISE.has(name)) return true; // Pydantic meta-field
  // ALL_CAPS = constant
  if (/^[A-Z_][A-Z0-9_]*$/.test(name)) return true;
  // dunder
  if (name.startsWith('__')) return true;
  // single char
  if (name.length <= 1) return true;
  return false;
}

// Brace-balanced extraction of a dict body starting immediately after an opening '{'.
// Returns the content between the opening brace (exclusive) and its matching '}' (exclusive).
function extractDictBody(content: string, openBraceIndex: number): string {
  let depth = 1;
  let pos = openBraceIndex + 1;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    pos++;
  }
  return content.slice(openBraceIndex + 1, pos - 1);
}

function extractStringKeys(dictBody: string, filePath: string, bodyOffset: number, fileContent: string): Field[] {
  const fields: Field[] = [];
  const keyRe = /["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(dictBody)) !== null) {
    const name = m[1];
    if (isNoiseName(name)) continue;
    const absoluteIndex = bodyOffset + m.index;
    const line = lineOf(fileContent, absoluteIndex);
    fields.push({ name, side: 'response', definedAt: `${filePath}:${line}`, wasteScore: 0 });
  }
  return fields;
}

// Collect byte ranges [start, end) for bodies of route-decorated functions.
// Only `return {...}` inside these ranges should be treated as response fields.
function routeFunctionRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // Match Flask/FastAPI route decorators
  const decoratorRe = /@(?:\w+\.)?(?:route|get|post|put|delete|patch|head|options)\s*\(/g;
  let dm: RegExpExecArray | null;
  while ((dm = decoratorRe.exec(content)) !== null) {
    // Find the `def` that follows this decorator (skip blank lines and other decorators)
    const defRe = /\bdef\s+\w+\s*\([^)]*\)\s*:/g;
    defRe.lastIndex = dm.index;
    const defMatch = defRe.exec(content);
    if (!defMatch) continue;

    // Determine the function body by indentation: collect lines until dedent
    const bodyStart = defMatch.index + defMatch[0].length;
    const lines = content.slice(bodyStart).split('\n');
    let bodyEnd = bodyStart;
    // First non-empty line sets the expected indent
    let expectedIndent = -1;
    for (const line of lines) {
      if (line.trim() === '') { bodyEnd += line.length + 1; continue; }
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (expectedIndent === -1) { expectedIndent = indent; }
      if (indent < expectedIndent) break;
      bodyEnd += line.length + 1;
    }
    ranges.push([bodyStart, bodyEnd]);
  }
  return ranges;
}

function inAnyRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => index >= s && index < e);
}

// Extract response fields defined in a Python backend file.
export function extractFields(filePath: string): Field[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields: Field[] = [];

  const routeRanges = routeFunctionRanges(content);

  // Pattern A: jsonify({...}) — always a response, no scoping needed
  const jsonifyRe = /jsonify\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = jsonifyRe.exec(content)) !== null) {
    const openBrace = m.index + m[0].lastIndexOf('{');
    const body = extractDictBody(content, openBrace);
    fields.push(...extractStringKeys(body, filePath, openBrace + 1, content));
  }

  // Pattern B: return {...} — only inside route-decorated functions
  const returnDictRe = /\breturn\s*\{/g;
  while ((m = returnDictRe.exec(content)) !== null) {
    if (!inAnyRange(m.index, routeRanges)) continue;
    const openBrace = m.index + m[0].lastIndexOf('{');
    const body = extractDictBody(content, openBrace);
    fields.push(...extractStringKeys(body, filePath, openBrace + 1, content));
  }

  // Pattern C: JSONResponse(content={...})
  const jsonResponseRe = /JSONResponse\s*\(\s*content\s*=\s*\{/g;
  while ((m = jsonResponseRe.exec(content)) !== null) {
    const openBrace = m.index + m[0].lastIndexOf('{');
    const body = extractDictBody(content, openBrace);
    fields.push(...extractStringKeys(body, filePath, openBrace + 1, content));
  }

  // Pattern D: Pydantic BaseModel class fields → side: 'request'
  // Capture from class declaration to next class declaration or end of string
  const classRe = /class\s+\w+\s*\(\s*BaseModel\s*\)\s*:([\s\S]*?)(?=\nclass |\Z|$)/g;
  while ((m = classRe.exec(content)) !== null) {
    const classBody = m[1];
    const classBodyStart = m.index + m[0].indexOf(':') + 1;
    // Match indented field names: "    fieldName: type"
    const fieldRe = /^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(classBody)) !== null) {
      const name = fm[1];
      if (isNoiseName(name)) continue;
      const absoluteIndex = classBodyStart + fm.index;
      const line = lineOf(content, absoluteIndex);
      fields.push({ name, side: 'request', definedAt: `${filePath}:${line}`, wasteScore: 0 });
    }
  }

  return dedup(fields);
}
