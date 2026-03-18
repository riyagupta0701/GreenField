// Person C — Java backend field extraction
// Extracts fields from Spring @ResponseBody DTOs and response maps
// Uses regex (same approach as backendDetector.ts) — no tree-sitter dependency
// NOTE: Java records (`record UserDto(String name)`) are not supported in MVP.

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

// Collect all class names used as @RequestBody parameters in the file.
// These are request DTOs — their fields are handled by usageTracker, not fieldExtractor.
function requestBodyClassNames(content: string): Set<string> {
  const names = new Set<string>();
  const re = /@RequestBody\s+(\w+(?:<[^>]+>)?)\s+\w+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    // Strip generics: List<UserDto> → UserDto
    names.add(m[1].replace(/<[^>]+>/, '').trim());
  }
  return names;
}

const JAVA_FIELD_NOISE = new Set([
  'equals', 'hashCode', 'toString', 'getClass', 'notify', 'notifyAll',
  'wait', 'clone', 'finalize', 'log', 'logger', 'serialVersionUID',
]);

function isNoiseName(name: string): boolean {
  if (JAVA_FIELD_NOISE.has(name)) return true;
  // ALL_CAPS = constant
  if (/^[A-Z_][A-Z0-9_]*$/.test(name)) return true;
  // class name (starts with uppercase)
  if (/^[A-Z]/.test(name)) return true;
  // single char
  if (name.length <= 1) return true;
  return false;
}

// Extract response fields defined in a Java backend file.
export function extractFields(filePath: string): Field[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields: Field[] = [];

  // Pre-compute which class names are @RequestBody params — usageTracker owns those.
  const reqBodyClasses = requestBodyClassNames(content);

  // Pattern A: DTO class fields — only for classes NOT used as @RequestBody.
  // We scan class bodies individually to avoid picking up request-DTO fields.
  // For each class found in the file, skip it if its name is in reqBodyClasses.
  const classDeclRe = /class\s+(\w+)\s*(?:extends\s+\w+\s*)?(?:implements[^{]+)?\{/g;
  const jsonPropInlineRe = /@JsonProperty\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\)/;
  let m: RegExpExecArray | null;
  while ((m = classDeclRe.exec(content)) !== null) {
    const className = m[1];
    if (reqBodyClasses.has(className)) continue; // request DTO — skip

    // Extract the class body by counting braces from the opening {
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let pos = bodyStart;
    while (pos < content.length && depth > 0) {
      if (content[pos] === '{') depth++;
      else if (content[pos] === '}') depth--;
      pos++;
    }
    const classBody = content.slice(bodyStart, pos - 1);

    const fieldDeclRe = /(?:(?:@\w+(?:\([^)]*\))?\s*)*)(?:private|public|protected)\s+(?:final\s+)?[\w<>\[\],\s]+\s+([a-z][a-zA-Z0-9_]*)\s*[;=]/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldDeclRe.exec(classBody)) !== null) {
      const javaName = fm[1];
      if (isNoiseName(javaName)) continue;
      const jpMatch = jsonPropInlineRe.exec(fm[0]);
      const fieldName = jpMatch ? jpMatch[1] : javaName;
      const absoluteIndex = bodyStart + fm.index;
      const line = lineOf(content, absoluteIndex);
      fields.push({ name: fieldName, side: 'response', definedAt: `${filePath}:${line}`, wasteScore: 0 });
    }
  }

  // Pattern B: Map.of("key", val, ...) — keys are at even positions (0, 2, 4, ...)
  const mapOfRe = /Map\.of\(([^)]+)\)/gs;
  while ((m = mapOfRe.exec(content)) !== null) {
    const inner = m[1];
    // Split by comma to find positional args; quoted strings at even indices are keys
    const tokens = inner.split(',').map(t => t.trim());
    for (let i = 0; i < tokens.length; i += 2) {
      const keyMatch = /^"([a-zA-Z_][a-zA-Z0-9_]*)"$/.exec(tokens[i]);
      if (!keyMatch) continue;
      const name = keyMatch[1];
      if (isNoiseName(name)) continue;
      const absoluteIndex = m.index + m[0].indexOf(tokens[i]);
      const line = lineOf(content, absoluteIndex);
      fields.push({ name, side: 'response', definedAt: `${filePath}:${line}`, wasteScore: 0 });
    }
  }

  // Pattern C: .put("key", val)
  const putRe = /\.put\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*,/g;
  while ((m = putRe.exec(content)) !== null) {
    const name = m[1];
    if (isNoiseName(name)) continue;
    const line = lineOf(content, m.index);
    fields.push({ name, side: 'response', definedAt: `${filePath}:${line}`, wasteScore: 0 });
  }

  return dedup(fields);
}
