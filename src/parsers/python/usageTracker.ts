// Tracks request field access: request.json.get(), data['field'], Pydantic binding
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

// Names that are not API request field names
const PYTHON_NOISE = new Set([
  'json', 'form', 'args', 'data', 'files', 'headers', 'method', 'url',
  'session', 'db', 'request', 'response', 'result', 'error', 'self', 'cls',
  'app', 'g', 'current_app', 'abort', 'redirect', 'render_template',
  'make_response', 'send_file', 'send_from_directory', 'flash', 'get_flashed_messages',
  'None', 'True', 'False', 'print', 'len', 'range', 'type', 'str', 'int', 'float',
  'list', 'dict', 'set', 'tuple', 'bool', 'bytes', 'object',
]);

function isNoiseName(name: string): boolean {
  if (PYTHON_NOISE.has(name)) return true;
  if (/^[A-Z_][A-Z0-9_]*$/.test(name)) return true;
  if (name.startsWith('__')) return true;
  if (name.length <= 1) return true;
  return false;
}

function addField(name: string, index: number, filePath: string, content: string, fields: Field[]): void {
  if (isNoiseName(name)) return;
  const line = lineOf(content, index);
  fields.push({ name, side: 'request', definedAt: `${filePath}:${line}`, wasteScore: 0 });
}

// Extract Pydantic BaseModel class body fields (for conservative rule E)
function extractModelFields(content: string, modelName: string): string[] {
  const classRe = new RegExp(
    `class\\s+${modelName}\\s*\\(\\s*BaseModel\\s*\\)\\s*:([\\s\\S]*?)(?=\\nclass |$)`,
    'g'
  );
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(content)) !== null) {
    const body = m[1];
    const fieldRe = /^\s{4}([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body)) !== null) {
      const name = fm[1];
      if (!isNoiseName(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

// Track request field reads in a Python backend file.
export function trackUsage(filePath: string): Field[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields: Field[] = [];

  // Pattern A1: request.json.get('x')
  const a1Re = /request\.json\.get\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\)/g;
  let m: RegExpExecArray | null;
  while ((m = a1Re.exec(content)) !== null) {
    addField(m[1], m.index, filePath, content, fields);
  }

  // Pattern A2: request.json['x']
  const a2Re = /request\.json\[['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\]/g;
  while ((m = a2Re.exec(content)) !== null) {
    addField(m[1], m.index, filePath, content, fields);
  }

  // Pattern B: indirect via `data = request.json`
  const indirectVarRe = /([a-zA-Z_]\w*)\s*=\s*request\.json/g;
  while ((m = indirectVarRe.exec(content)) !== null) {
    const varName = m[1];

    // B1: varName.get('x')
    const b1Re = new RegExp(
      `${varName}\\.get\\(\\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\\)`,
      'g'
    );
    let bm: RegExpExecArray | null;
    while ((bm = b1Re.exec(content)) !== null) {
      addField(bm[1], bm.index, filePath, content, fields);
    }

    // B2: varName['x'] — but NOT varName[someVar] (conservative)
    const b2Re = new RegExp(`${varName}\\[['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\\]`, 'g');
    while ((bm = b2Re.exec(content)) !== null) {
      addField(bm[1], bm.index, filePath, content, fields);
    }
  }

  // Pattern C: request.form.get('x')
  const cRe = /request\.form\.get\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\)/g;
  while ((m = cRe.exec(content)) !== null) {
    addField(m[1], m.index, filePath, content, fields);
  }

  // Pattern D: request.args.get('x')
  const dRe = /request\.args\.get\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\)/g;
  while ((m = dRe.exec(content)) !== null) {
    addField(m[1], m.index, filePath, content, fields);
  }

  // Pattern E: Pydantic model param in function signature
  // e.g. def create(item: ItemModel) — conservative: emit ALL model fields as accessed
  const sigRe = /def\s+\w+\s*\([^)]*\b(\w+)\s*:\s*([A-Z]\w*)[^)]*\)/g;
  while ((m = sigRe.exec(content)) !== null) {
    const paramName = m[1];
    const modelName = m[2];

    // Check if this model has a BaseModel class in file
    const modelFields = extractModelFields(content, modelName);
    if (modelFields.length === 0) continue;

    // Check if param is accessed with explicit field access in file
    const fieldAccessRe = new RegExp(`${paramName}\\.([a-zA-Z_][a-zA-Z0-9_]*)`, 'g');
    const accessedFields: string[] = [];
    let fa: RegExpExecArray | null;
    while ((fa = fieldAccessRe.exec(content)) !== null) {
      if (!isNoiseName(fa[1])) accessedFields.push(fa[1]);
    }

    if (accessedFields.length > 0) {
      // Explicit field accesses found — track only those
      for (const fa2 of accessedFields) {
        addField(fa2, m.index, filePath, content, fields);
      }
    } else {
      // No explicit field access — conservative: emit all model fields as accessed
      for (const fieldName of modelFields) {
        addField(fieldName, m.index, filePath, content, fields);
      }
    }
  }

  return dedup(fields);
}
