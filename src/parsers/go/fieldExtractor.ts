// Go backend field extraction
// Extracts response fields from gin.H literals, map[string]interface{} / map[string]any literals,
// and response struct type declarations with json tags.
// Uses regex — no external Go parser dependency.

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

const GO_FIELD_NOISE = new Set([
  'err', 'ok', 'ctx', 'w', 'r', 'c', 'db', 'id', 'tx',
  'nil', 'true', 'false', 'error', 'string', 'int', 'bool', 'any',
]);

function isNoiseName(name: string): boolean {
  if (GO_FIELD_NOISE.has(name)) return true;
  if (/^[A-Z_][A-Z0-9_]*$/.test(name)) return true; // ALL_CAPS constants
  if (name.length <= 1) return true;
  return false;
}

// Returns the content between matching braces, exclusive of the delimiters.
// openBraceIndex must point to the '{' character.
function extractBraceBody(content: string, openBraceIndex: number): string {
  let depth = 1;
  let pos = openBraceIndex + 1;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    pos++;
  }
  return content.slice(openBraceIndex + 1, pos - 1);
}

// Extracts string-keyed fields from a Go map/gin.H brace body.
// bodyOffset is the absolute index in fileContent of the character after the opening '{'.
function extractStringKeys(
  body: string,
  filePath: string,
  bodyOffset: number,
  fileContent: string,
  side: 'request' | 'response'
): Field[] {
  const fields: Field[] = [];
  const keyRe = /"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body)) !== null) {
    const name = m[1];
    if (isNoiseName(name)) continue;
    const absoluteIndex = bodyOffset + m.index;
    const line = lineOf(fileContent, absoluteIndex);
    fields.push({ name, side, definedAt: `${filePath}:${line}`, wasteScore: 0 });
  }
  return fields;
}

// Parsed result for a single Go struct field.
interface ParsedStructField {
  goName: string;
  jsonName: string;
  absoluteIndex: number; // position in file content for line number computation
}

// Extracts fields from a named Go struct declaration in content.
// Skips embedded (anonymous) fields — these have no identifier+type pair on the line.
// Handles: json tags, omitempty stripping, json:"-" skip, fallback to lowercase Go ident.
function extractStructFields(content: string, structName: string): ParsedStructField[] {
  const results: ParsedStructField[] = [];
  const structHeadRe = new RegExp(`\\btype\\s+${structName}\\s+struct\\s*\\{`, 'g');
  let m: RegExpExecArray | null;

  while ((m = structHeadRe.exec(content)) !== null) {
    const openBraceIndex = m.index + m[0].length - 1;
    // Brace-count to find the struct body end
    let depth = 1;
    let pos = openBraceIndex + 1;
    while (pos < content.length && depth > 0) {
      if (content[pos] === '{') depth++;
      else if (content[pos] === '}') depth--;
      pos++;
    }
    const bodyStart = openBraceIndex + 1;
    const body = content.slice(bodyStart, pos - 1);

    // Match struct field lines: leading whitespace, GoName, whitespace, Type, optional tag
    // Embedded fields (e.g. "  BaseEntity") have no type after the name — they won't match
    // because the type portion (\s+\S) is required.
    const fieldLineRe = /^[ \t]+([A-Za-z][a-zA-Z0-9_]*)[ \t]+\S[^\n`]*(`[^`]*`)?[ \t]*$/gm;
    let fl: RegExpExecArray | null;
    while ((fl = fieldLineRe.exec(body)) !== null) {
      const goName = fl[1];
      const lineText = fl[0];

      // Extract json tag if present
      const jsonTagRe = /`[^`]*json:"([^"]*)"[^`]*`/;
      const tagMatch = jsonTagRe.exec(lineText);

      let jsonName: string;
      if (tagMatch) {
        const rawTag = tagMatch[1].split(',')[0].trim();
        if (rawTag === '-') continue; // json:"-" → skip entirely
        // Empty name before comma (e.g. json:",omitempty") → fallback to lowercase Go ident
        jsonName = rawTag || (goName.charAt(0).toLowerCase() + goName.slice(1));
      } else {
        // No json tag → lowercase first char of Go identifier
        jsonName = goName.charAt(0).toLowerCase() + goName.slice(1);
      }

      const absoluteIndex = bodyStart + fl.index;
      results.push({ goName, jsonName, absoluteIndex });
    }
  }

  return results;
}

// Returns the set of struct type names that appear as bind targets (ShouldBindJSON / BindJSON / Decode).
// These are request structs — fieldExtractor should NOT emit their fields as response fields.
function bindTargetStructNames(content: string): Set<string> {
  const names = new Set<string>();

  const bindCallRe = /(?:ShouldBindJSON|BindJSON|\.Decode)\s*\(\s*&\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g;
  let m: RegExpExecArray | null;

  while ((m = bindCallRe.exec(content)) !== null) {
    const varName = m[1];

    // var varName TypeName
    const varDeclRe = new RegExp(`\\bvar\\s+${varName}\\s+([A-Z][a-zA-Z0-9_]*)\\b`);
    let vd = varDeclRe.exec(content);
    if (vd) { names.add(vd[1]); continue; }

    // varName := TypeName{}
    const shortDeclRe = new RegExp(`\\b${varName}\\s*:=\\s*([A-Z][a-zA-Z0-9_]*)\\s*\\{`);
    vd = shortDeclRe.exec(content);
    if (vd) { names.add(vd[1]); continue; }

    // function parameter: varName TypeName
    const paramRe = new RegExp(`\\b${varName}\\s+([A-Z][a-zA-Z0-9_]*)\\b`);
    vd = paramRe.exec(content);
    if (vd) names.add(vd[1]);
  }

  return names;
}

// Extract response fields defined in a Go backend file.
export function extractFields(filePath: string): Field[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields: Field[] = [];

  // Pre-compute bind-target struct names so Pattern C can exclude request structs.
  const bindTargets = bindTargetStructNames(content);

  // Pattern A: gin.H{"key": value, ...}
  const ginHRe = /\bgin\.H\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = ginHRe.exec(content)) !== null) {
    const openBrace = m.index + m[0].length - 1;
    const body = extractBraceBody(content, openBrace);
    fields.push(...extractStringKeys(body, filePath, openBrace + 1, content, 'response'));
  }

  // Pattern B: map[string]interface{}{"key": value} or map[string]any{"key": value}
  const mapLiteralRe = /\bmap\[string\](?:interface\s*\{\s*\}|any)\s*\{/g;
  while ((m = mapLiteralRe.exec(content)) !== null) {
    const openBrace = m.index + m[0].length - 1;
    const body = extractBraceBody(content, openBrace);
    fields.push(...extractStringKeys(body, filePath, openBrace + 1, content, 'response'));
  }

  // Pattern C: type Foo struct {...} — only structs NOT used as bind targets
  const typeStructRe = /\btype\s+([A-Z][a-zA-Z0-9_]*)\s+struct\s*\{/g;
  while ((m = typeStructRe.exec(content)) !== null) {
    const structName = m[1];
    if (bindTargets.has(structName)) continue; // request struct — skip

    const parsedFields = extractStructFields(content, structName);
    for (const { jsonName, absoluteIndex } of parsedFields) {
      if (isNoiseName(jsonName)) continue;
      const line = lineOf(content, absoluteIndex);
      fields.push({ name: jsonName, side: 'response', definedAt: `${filePath}:${line}`, wasteScore: 0 });
    }
  }

  return dedup(fields);
}
