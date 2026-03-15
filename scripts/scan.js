/**
 * Standalone GreenField scanner — runs outside VS Code
 * Usage: node scripts/scan.js <directory>
 */
const path = require('path');
const fs = require('fs');
const { mapEndpoints } = require('../dist-test/src/endpointMapper');
const { extractFields } = require('../dist-test/src/parsers/typescript/fieldExtractor');
const { trackUsage } = require('../dist-test/src/parsers/typescript/usageTracker');

const { Project } = require('ts-morph');
const sharedProject = new Project({ skipLoadingLibFiles: true });

const targetDir = process.argv[2];
if (!targetDir) { console.error('Usage: node scripts/scan.js <dir>'); process.exit(1); }

function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules','dist','build','.git','__pycache__','coverage'].includes(entry.name)) continue;
      results.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

const files = collectFiles(path.resolve(targetDir));
for (const f of files) {
  if (!sharedProject.getSourceFile(f)) sharedProject.addSourceFileAtPath(f);
}
const fileContents = files.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') }));

console.log(`\n Scanned ${files.length} TypeScript files in ${path.resolve(targetDir)}\n`);

// 1. Endpoint mapping
const endpoints = mapEndpoints(fileContents);
console.log(`🔗  Endpoints detected: ${endpoints.length}`);
endpoints.forEach(e => {
  console.log(`    ${e.pattern}`);
  if (e.backendFile) console.log(`       backend:  ${path.relative(targetDir, e.backendFile)}`);
  e.frontendFiles.forEach(f => console.log(`       frontend: ${path.relative(targetDir, f)}`));
});

// 2. Request body field extraction (frontend → backend)
console.log('\n Field extraction (request bodies sent by frontend):');
let totalDefinedFields = 0;
const allDefinedByFile = {};
for (const f of files) {
  try {
    const defined = extractFields(f, sharedProject);
    if (defined.length > 0) {
      totalDefinedFields += defined.length;
      allDefinedByFile[f] = defined;
      console.log(`    ${path.relative(targetDir, f)}`);
      defined.forEach(d => console.log(`       + ${d.name}  (line ${d.definedAt.split(':').pop()})`));
    }
  } catch(e) { /* skip unparseable files */ }
}
if (totalDefinedFields === 0) console.log('    (none found)');

// 3. Backend response field extraction
console.log('\n Backend response field extraction (res.json({...})):');
const backendResponseByFile = {};
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const isBackendFile = /(?:app|router)\.(get|post|put|delete|patch)\s*\(/.test(content) ||
                        /res\.(json|send)\s*\(\s*\{/.test(content);
  if (!isBackendFile) continue;
  try {
    const resJsonRegex = /res\.(?:json|send)\(\s*\{([^}]+)\}/g;
    const fieldsFound = [];
    for (const match of content.matchAll(resJsonRegex)) {
      const propRegex = /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::|,|$)/gm;
      for (const propMatch of match[1].matchAll(propRegex)) {
        const name = propMatch[1].trim();
        if (name) fieldsFound.push(name);
      }
    }
    if (fieldsFound.length > 0) {
      backendResponseByFile[f] = [...new Set(fieldsFound)];
      console.log(`    ${path.relative(targetDir, f)}: [${backendResponseByFile[f].join(', ')}]`);
    }
  } catch(e) { /* skip */ }
}
if (Object.keys(backendResponseByFile).length === 0) {
  console.log('    (none found — backend may be non-TypeScript or use a different response pattern)');
}

// 4. Usage tracking
console.log('\n Usage tracking (response fields accessed by frontend):');
let totalTrackedFields = 0;
const allTrackedByFile = {};
for (const f of files) {
  try {
    const tracked = trackUsage(f, sharedProject);
    if (tracked.length > 0) {
      totalTrackedFields += tracked.length;
      allTrackedByFile[f] = tracked;
      console.log(`    ${path.relative(targetDir, f)}: [${tracked.map(t => t.name).join(', ')}]`);
    }
  } catch(e) { /* skip */ }
}
if (totalTrackedFields === 0) console.log('    (none found)');

// 5. Dead field diff
function computeDiff(defined, accessed) {
  const accessedNames = new Set(accessed.map(f => f.name));
  return defined.filter(f => !accessedNames.has(f.name));
}

const allAccessed = Object.values(allTrackedByFile).flat();
const FRONTEND_ACCESSED_NAMES = new Set(allAccessed.map(f => f.name));
const allBackendFields = [...new Set(Object.values(backendResponseByFile).flat())];

console.log('\n Dead field analysis (backend response → frontend read):');
let backendDead = 0;
const backendTotal = allBackendFields.length;

if (backendTotal > 0) {
  const dead = allBackendFields.filter(n => !FRONTEND_ACCESSED_NAMES.has(n));
  const used = allBackendFields.filter(n =>  FRONTEND_ACCESSED_NAMES.has(n));
  backendDead = dead.length;
  console.log(`\n    Backend sends:  [${allBackendFields.join(', ')}]`);
  console.log(`    Frontend reads: [${used.join(', ') || 'none'}]`);
  if (dead.length > 0) console.log(`    DEAD:        [${dead.join(', ')}]`);
  else                 console.log(`    All response fields are read by frontend`);
} else {
  console.log('    (no backend response fields extracted)');
}

// 6. Summary
const avgFieldBytes = 24;
const wastedBytes   = backendDead * avgFieldBytes;
const co2Wh         = wastedBytes * 10000 * 0.000000006 * 1000;

console.log('\n════════════════════════════════════════════');
console.log('  GreenField Scan Summary');
console.log('════════════════════════════════════════════');
console.log(`  Target:                    ${path.resolve(targetDir)}`);
console.log(`  Files scanned:             ${files.length}`);
console.log(`  Endpoints mapped:          ${endpoints.length}`);
console.log(`  Request body fields found: ${totalDefinedFields}`);
console.log(`  Response fields tracked:   ${totalTrackedFields}`);
console.log(`  Backend response fields:   ${backendTotal}`);
if (backendTotal > 0) {
  console.log(`  Dead response fields:      ${backendDead} / ${backendTotal} (${Math.round(backendDead/backendTotal*100)}%)`);
  console.log(`  Est. wasted bytes/request: ~${wastedBytes} bytes`);
  console.log(`  Est. CO2 waste @10k req/d: ~${co2Wh.toFixed(4)} Wh/day`);
}
console.log('════════════════════════════════════════════\n');
