// Go backend usage tracking
// Tracks request field reads: ShouldBindJSON/BindJSON/Decode struct binding,
// c.Query, c.PostForm, r.URL.Query().Get, r.FormValue.
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

const GO_USAGE_NOISE = new Set([
  'err', 'ok', 'ctx', 'w', 'r', 'c', 'db', 'id', 'tx', 'req', 'res',
  'body', 'buf', 'msg', 'key', 'val', 'tmp', 'i', 'j', 'n',
  'nil', 'true', 'false', 'error', 'string', 'int', 'bool', 'any',
  'http', 'json', 'fmt', 'log', 'time', 'sync', 'context',
]);

function isNoiseName(name: string): boolean {
  if (GO_USAGE_NOISE.has(name)) return true;
  if (/^[A-Z_][A-Z0-9_]*$/.test(name)) return true; // ALL_CAPS constants
  if (name.length <= 1) return true;
  return false;
}

// Parsed result for a single Go struct field.
interface ParsedStructField {
  goName: string;
  jsonName: string;
  absoluteIndex: number;
}

// Extracts fields from a named Go struct declaration in content.
// Skips embedded (anonymous) fields — these have no identifier+type pair.
// Handles json tags, omitempty stripping, json:"-" skip, fallback to lowercase Go ident.
function extractStructFields(content: string, structName: string): ParsedStructField[] {
  const results: ParsedStructField[] = [];
  const structHeadRe = new RegExp(`\\btype\\s+${structName}\\s+struct\\s*\\{`, 'g');
  let m: RegExpExecArray | null;

  while ((m = structHeadRe.exec(content)) !== null) {
    const openBraceIndex = m.index + m[0].length - 1;
    let depth = 1;
    let pos = openBraceIndex + 1;
    while (pos < content.length && depth > 0) {
      if (content[pos] === '{') depth++;
      else if (content[pos] === '}') depth--;
      pos++;
    }
    const bodyStart = openBraceIndex + 1;
    const body = content.slice(bodyStart, pos - 1);

    const fieldLineRe = /^[ \t]+([A-Za-z][a-zA-Z0-9_]*)[ \t]+\S[^\n`]*(`[^`]*`)?[ \t]*$/gm;
    let fl: RegExpExecArray | null;
    while ((fl = fieldLineRe.exec(body)) !== null) {
      const goName = fl[1];
      const lineText = fl[0];

      const jsonTagRe = /`[^`]*json:"([^"]*)"[^`]*`/;
      const tagMatch = jsonTagRe.exec(lineText);

      let jsonName: string;
      if (tagMatch) {
        const rawTag = tagMatch[1].split(',')[0].trim();
        if (rawTag === '-') continue;
        jsonName = rawTag || (goName.charAt(0).toLowerCase() + goName.slice(1));
      } else {
        jsonName = goName.charAt(0).toLowerCase() + goName.slice(1);
      }

      const absoluteIndex = bodyStart + fl.index;
      results.push({ goName, jsonName, absoluteIndex });
    }
  }

  return results;
}

// Resolves the declared struct type name for a variable used in a bind call.
// Tries: var varName TypeName, varName := TypeName{}, function param varName TypeName.
function resolveVarType(content: string, varName: string): string | null {
  // var varName TypeName
  const varDeclRe = new RegExp(`\\bvar\\s+${varName}\\s+([A-Z][a-zA-Z0-9_]*)\\b`);
  let m = varDeclRe.exec(content);
  if (m) return m[1];

  // varName := TypeName{}
  const shortDeclRe = new RegExp(`\\b${varName}\\s*:=\\s*([A-Z][a-zA-Z0-9_]*)\\s*\\{`);
  m = shortDeclRe.exec(content);
  if (m) return m[1];

  // function parameter: varName TypeName
  const paramRe = new RegExp(`\\b${varName}\\s+([A-Z][a-zA-Z0-9_]*)\\b`);
  m = paramRe.exec(content);
  if (m) return m[1];

  return null;
}

// Track request field reads in a Go backend file.
export function trackUsage(filePath: string): Field[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields: Field[] = [];

  function addField(name: string, index: number): void {
    if (isNoiseName(name)) return;
    const line = lineOf(content, index);
    fields.push({ name, side: 'request', definedAt: `${filePath}:${line}`, wasteScore: 0 });
  }

  // Pattern A: c.ShouldBindJSON(&req) or c.BindJSON(&req)  [gin]
  // Conservative: emit ALL struct fields as accessed (same as Java @RequestBody rule)
  const ginBindRe = /\.(?:ShouldBindJSON|BindJSON)\s*\(\s*&\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = ginBindRe.exec(content)) !== null) {
    const varName = m[1];
    const typeName = resolveVarType(content, varName);
    if (!typeName) continue;
    for (const { jsonName } of extractStructFields(content, typeName)) {
      addField(jsonName, m.index);
    }
  }

  // Pattern B: json.NewDecoder(r.Body).Decode(&req)  [net/http]
  const decodeRe = /\.Decode\s*\(\s*&\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g;
  while ((m = decodeRe.exec(content)) !== null) {
    const varName = m[1];
    const typeName = resolveVarType(content, varName);
    if (!typeName) continue;
    for (const { jsonName } of extractStructFields(content, typeName)) {
      addField(jsonName, m.index);
    }
  }

  // Pattern C: c.Query("field")  [gin]
  const ginQueryRe = /\.Query\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/g;
  while ((m = ginQueryRe.exec(content)) !== null) {
    addField(m[1], m.index);
  }

  // Pattern C: r.URL.Query().Get("field")  [net/http]
  // Must be distinct from c.Query — matched by requiring .Query().Get(
  const httpQueryRe = /\.Query\(\)\.Get\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/g;
  while ((m = httpQueryRe.exec(content)) !== null) {
    addField(m[1], m.index);
  }

  // Pattern D: c.PostForm("field")  [gin]
  const ginPostFormRe = /\.PostForm\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/g;
  while ((m = ginPostFormRe.exec(content)) !== null) {
    addField(m[1], m.index);
  }

  // Pattern D: r.FormValue("field")  [net/http]
  const httpFormValueRe = /\.FormValue\s*\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/g;
  while ((m = httpFormValueRe.exec(content)) !== null) {
    addField(m[1], m.index);
  }

  return dedup(fields);
}
