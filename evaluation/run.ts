/**
 * RQ1 — Accuracy Evaluation
 *
 * Runs the diff engine against all 20 synthetic benchmark projects and
 * computes precision and recall per project and overall.
 *
 * Usage:
 *   npx ts-node evaluation/run.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeDiff } from '../src/diffEngine/differ';
import { Field } from '../src/types';
import { extractFields as tsExtractFields } from '../src/parsers/typescript/fieldExtractor';
import { trackUsage   as tsTrackUsage   } from '../src/parsers/typescript/usageTracker';
import { extractFields as pyExtractFields } from '../src/parsers/python/fieldExtractor';
import { trackUsage   as javaTrackUsage } from '../src/parsers/java/usageTracker';

const BENCHMARKS_DIR = path.resolve(__dirname, '../../test/benchmarks/synthetic');

interface Expected {
  endpoint: string;
  deadFields: string[];
}

interface ProjectResult {
  project: string;
  expected: string[];
  detected: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
}

function loadExpected(projectDir: string): Expected {
  const raw = fs.readFileSync(path.join(projectDir, 'expected.json'), 'utf8');
  return JSON.parse(raw) as Expected;
}

function filesIn(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => path.join(dir, f));
}

/**
 * Loads defined + accessed fields for a project.
 *
 * Strategy by backend language:
 *
 *  Python backend (projects 16–17 — response fields):
 *    defined  = Python extractFields on backend .py files
 *    accessed = TS trackUsage on frontend .ts files
 *
 *  Java backend (projects 18–20 — request fields):
 *    defined  = TS extractFields on frontend .ts files  (what frontend sends)
 *    accessed = Java trackUsage on backend .java files  (what backend reads)
 *
 *  TS backend (projects 01–15):
 *    The TS extractor handles frontend request bodies, not backend res.json().
 *    Falls back to fields.json (gitignored local stub) until a TS backend
 *    response extractor is implemented.
 */
function loadFields(projectDir: string): { defined: Field[]; accessed: Field[] } | null {
  const backendDir  = path.join(projectDir, 'backend');
  const frontendDir = path.join(projectDir, 'frontend');

  const pyFiles   = filesIn(backendDir, '.py');
  const javaFiles = filesIn(backendDir, '.java');
  const tsFiles   = [
    ...filesIn(frontendDir, '.ts'),
    ...filesIn(frontendDir, '.tsx'),
  ];

  if (pyFiles.length > 0) {
    // Python backend → response fields
    const defined  = pyFiles.flatMap(f => pyExtractFields(f));
    const accessed = tsFiles.flatMap(f => tsTrackUsage(f));
    return { defined, accessed };
  }

  if (javaFiles.length > 0) {
    // Java backend → request fields (frontend sends, backend reads)
    const defined  = tsFiles.flatMap(f => tsExtractFields(f));
    const accessed = javaFiles.flatMap(f => javaTrackUsage(f));
    return { defined, accessed };
  }

  // TS backend — fall back to hand-crafted fields.json stub
  const stub = path.join(projectDir, 'fields.json');
  if (!fs.existsSync(stub)) return null;
  return JSON.parse(fs.readFileSync(stub, 'utf8')) as { defined: Field[]; accessed: Field[] };
}

function evaluate(): void {
  const projects = fs
    .readdirSync(BENCHMARKS_DIR)
    .filter(d => d.startsWith('project-'))
    .sort();

  const results: ProjectResult[] = [];
  const skipped: string[] = [];

  for (const project of projects) {
    const dir = path.join(BENCHMARKS_DIR, project);
    const expected = loadExpected(dir);
    const fields = loadFields(dir);

    if (!fields) {
      skipped.push(project);
      continue;
    }

    const deadFields   = computeDiff(fields.defined, fields.accessed);
    const detectedNames = deadFields.map(f => f.name);
    const expectedNames = expected.deadFields;

    const tp = detectedNames.filter(n =>  expectedNames.includes(n)).length;
    const fp = detectedNames.filter(n => !expectedNames.includes(n)).length;
    const fn = expectedNames.filter(n => !detectedNames.includes(n)).length;

    const precision = tp + fp === 0 ? 1.0 : tp / (tp + fp);
    const recall    = tp + fn === 0 ? 1.0 : tp / (tp + fn);

    results.push({
      project,
      expected: expectedNames,
      detected: detectedNames,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision,
      recall,
    });
  }

  // Per-project report
  console.log('\n=== RQ1 — Per-project Results ===\n');
  for (const r of results) {
    const p   = (r.precision * 100).toFixed(1);
    const rec = (r.recall    * 100).toFixed(1);
    const status = r.precision === 1.0 && r.recall === 1.0 ? '✓' : '✗';
    console.log(`${status} ${r.project}`);
    console.log(`    Expected:  [${r.expected.join(', ')}]`);
    console.log(`    Detected:  [${r.detected.join(', ')}]`);
    console.log(`    TP=${r.truePositives}  FP=${r.falsePositives}  FN=${r.falseNegatives}`);
    console.log(`    Precision=${p}%  Recall=${rec}%\n`);
  }

  // Aggregate 
  if (results.length > 0) {
    const totalTP = results.reduce((s, r) => s + r.truePositives, 0);
    const totalFP = results.reduce((s, r) => s + r.falsePositives, 0);
    const totalFN = results.reduce((s, r) => s + r.falseNegatives, 0);
    const macroPrecision = results.reduce((s, r) => s + r.precision, 0) / results.length;
    const macroRecall    = results.reduce((s, r) => s + r.recall,    0) / results.length;
    const microPrecision = totalTP / (totalTP + totalFP) || 1.0;
    const microRecall    = totalTP / (totalTP + totalFN) || 1.0;

    console.log('=== Aggregate ===');
    console.log(`Projects evaluated: ${results.length} / ${projects.length}`);
    if (skipped.length) console.log(`Skipped (no fields.json stub): ${skipped.join(', ')}`);
    console.log(`Macro Precision: ${(macroPrecision * 100).toFixed(1)}%`);
    console.log(`Macro Recall:    ${(macroRecall    * 100).toFixed(1)}%`);
    console.log(`Micro Precision: ${(microPrecision * 100).toFixed(1)}%`);
    console.log(`Micro Recall:    ${(microRecall    * 100).toFixed(1)}%`);
  } else {
    console.log('No projects evaluated yet.');
    if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
  }
}

evaluate();
