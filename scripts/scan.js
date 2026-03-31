/**
 * Standalone GreenField scanner — runs outside VS Code
 * Usage: node scripts/scan.js <directory>
 */
const path = require('path');
const fs = require('fs');
const { mapEndpoints } = require('../dist-test/src/endpointMapper');
const { extractFields, trackUsage, extractBackendResponseFields } = require('../dist-test/src/parsers/typescript');
const { extractFields: pyExtractFields } = require('../dist-test/src/parsers/python/fieldExtractor');
const { extractFields: javaExtractFields } = require('../dist-test/src/parsers/java/fieldExtractor');
const { trackUsage: javaTrackUsage } = require('../dist-test/src/parsers/java/usageTracker');
const { extractFields: goExtractFields } = require('../dist-test/src/parsers/go/fieldExtractor');
const { runDiff, scoreWaste } = require('../dist-test/src/diffEngine');
const { KWH_PER_BYTE } = require('../dist-test/src/diffEngine/scorer');

const { Project } = require('ts-morph');
const sharedProject = new Project({ skipLoadingLibFiles: true });

const targetDir = process.argv[2];
if (!targetDir) { console.error('Usage: node scripts/scan.js <dir>'); process.exit(1); }

const SKIP_DIRS = new Set(['node_modules','dist','build','.git','__pycache__','coverage','.venv','venv']);

function collectFiles(dir, exts) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...collectFiles(full, exts));
    } else if (exts.some(ext => full.endsWith(ext)) && !full.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

const tsFiles   = collectFiles(path.resolve(targetDir), ['.ts', '.tsx', '.js', '.jsx']);
const pyFiles   = collectFiles(path.resolve(targetDir), ['.py']);
const javaFiles = collectFiles(path.resolve(targetDir), ['.java']);
const goFiles   = collectFiles(path.resolve(targetDir), ['.go']);

for (const f of tsFiles) {
  if (!sharedProject.getSourceFile(f)) sharedProject.addSourceFileAtPath(f);
}

const fileContents = [
  ...tsFiles.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') })),
  ...pyFiles.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') })),
  ...javaFiles.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') })),
  ...goFiles.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') })),
];

console.log(`\n Scanned ${tsFiles.length} TypeScript / ${pyFiles.length} Python / ${javaFiles.length} Java / ${goFiles.length} Go files in ${path.resolve(targetDir)}\n`);

// ─── 1. Endpoint mapping ──────────────────────────────────────────────────────

const endpoints = mapEndpoints(fileContents);
console.log(`🔗  Endpoints detected: ${endpoints.length}`);
endpoints.forEach(e => {
  console.log(`    ${e.pattern}`);
  if (e.backendFile) console.log(`       backend:  ${path.relative(targetDir, e.backendFile)}`);
  e.frontendFiles.forEach(f => console.log(`       frontend: ${path.relative(targetDir, f)}`));
});

// ─── 2. Per-endpoint analysis (mirrors extension's buildFieldSet + runDiff) ───

function buildFieldSet(endpoint) {
  const { backendFile, frontendFiles } = endpoint;
  if (!backendFile || frontendFiles.length === 0) return null;

  let definedFields  = [];
  let accessedFields = [];

  try {
    if (backendFile.endsWith('.py')) {
      definedFields  = pyExtractFields(backendFile);
      accessedFields = frontendFiles.flatMap(f => { try { return trackUsage(f, sharedProject); } catch { return []; } });
    } else if (backendFile.endsWith('.java')) {
      definedFields  = frontendFiles.flatMap(f => { try { return extractFields(f, sharedProject); } catch { return []; } });
      accessedFields = javaTrackUsage(backendFile);
    } else if (backendFile.endsWith('.go')) {
      definedFields  = goExtractFields(backendFile);
      accessedFields = frontendFiles.flatMap(f => { try { return trackUsage(f, sharedProject); } catch { return []; } });
    } else if (/\.[jt]sx?$/.test(backendFile)) {
      definedFields  = extractBackendResponseFields(backendFile, sharedProject);
      accessedFields = frontendFiles.flatMap(f => { try { return trackUsage(f, sharedProject); } catch { return []; } });
    }
  } catch { return null; }

  return { endpoint, definedFields, accessedFields, deadFields: [] };
}

const fieldSets = endpoints
  .map(buildFieldSet)
  .filter(fs => fs !== null)
  .map(fs => runDiff(fs));

const endpointDeadTotal = fieldSets.reduce((n, fs) => n + (fs.deadFields?.length ?? 0), 0);
if (endpointDeadTotal > 0) {
  console.log(`\n Per-endpoint dead fields: ${endpointDeadTotal}`);
  for (const fs of fieldSets) {
    if (!fs.deadFields?.length) continue;
    console.log(`    ${fs.endpoint.pattern}`);
    fs.deadFields.forEach(f => console.log(`       DEAD: ${f.name}  (waste: ${f.wasteScore} bytes/day)`));
  }
}

// ─── 3. Global fallback analysis (mirrors extension — all files, all languages)

const allAccessedNames = new Set(
  tsFiles.flatMap(f => { try { return trackUsage(f, sharedProject); } catch { return []; } }).map(f => f.name)
);

function globalAnalysisForLang(extractFn, langFiles) {
  let total = 0;
  const dead = langFiles.flatMap(f => {
    try {
      const all = extractFn(f).filter(field => field.side === 'response');
      total += all.length;
      return all
        .filter(field => !allAccessedNames.has(field.name))
        .map(field => ({ ...field, wasteScore: scoreWaste(field) }));
    } catch { return []; }
  });
  return { dead, total };
}

const rawGlobal = {
  ts:   globalAnalysisForLang(f => extractBackendResponseFields(f, sharedProject), tsFiles),
  py:   globalAnalysisForLang(pyExtractFields,   pyFiles),
  java: globalAnalysisForLang(javaExtractFields, javaFiles),
  go:   globalAnalysisForLang(goExtractFields,   goFiles),
};

const globalAnalysis = {
  ts:   rawGlobal.ts.dead,
  py:   rawGlobal.py.dead,
  java: rawGlobal.java.dead,
  go:   rawGlobal.go.dead,
};

const globalDeadFields_ = Object.values(globalAnalysis).flat();
const globalDeadTotal   = globalDeadFields_.length;
const globalResponseTotal = Object.values(rawGlobal).reduce((n, r) => n + r.total, 0);

if (globalDeadTotal > 0) {
  console.log(`\n Global fallback dead fields: ${globalDeadTotal}`);
  for (const [lang, fields] of Object.entries(globalAnalysis)) {
    if (!fields.length) continue;
    console.log(`    [${lang}]`);
    fields.forEach(f => console.log(`       DEAD: ${f.name}  @ ${path.relative(targetDir, f.definedAt?.split(':')[0] ?? '')}  (waste: ${f.wasteScore} bytes/day)`));
  }
}

// ─── 4. Summary ───────────────────────────────────────────────────────────────

const totalDead = endpointDeadTotal + globalDeadTotal;
const totalResponseFields =
  fieldSets.reduce((n, fs) => n + (fs.definedFields?.length ?? 0), 0) + globalResponseTotal;

const endpointWaste = fieldSets.reduce((n, fs) =>
  n + (fs.deadFields?.reduce((s, f) => s + (f.wasteScore ?? 0), 0) ?? 0), 0);
const globalWaste = globalDeadFields_.reduce((s, f) => s + (f.wasteScore ?? 0), 0);
const totalWasteBytes = endpointWaste + globalWaste;

const co2Wh = totalWasteBytes * KWH_PER_BYTE * 1000; // kWh → Wh

console.log('\n════════════════════════════════════════════');
console.log('  GreenField Scan Summary');
console.log('════════════════════════════════════════════');
console.log(`  Target:                    ${path.resolve(targetDir)}`);
console.log(`  Files scanned:             ${tsFiles.length} TS / ${pyFiles.length} Py / ${javaFiles.length} Java / ${goFiles.length} Go`);
console.log(`  Endpoints mapped:          ${endpoints.length}`);
console.log(`  Response fields scanned:   ${totalResponseFields}`);
console.log(`  Dead fields (per-endpoint):${endpointDeadTotal}`);
console.log(`  Dead fields (global):      ${globalDeadTotal}`);
console.log(`  Total dead fields:         ${totalDead} / ${totalResponseFields} (${totalResponseFields > 0 ? Math.round(totalDead / totalResponseFields * 100) : 0}%)`);
console.log(`  Est. wasted bytes/day:     ~${totalWasteBytes} bytes (~${(totalWasteBytes / 1000).toFixed(1)} KB)`);
console.log(`  Est. CO₂ waste @10k req/d: ~${co2Wh.toFixed(4)} Wh/day`);
console.log('════════════════════════════════════════════\n');
