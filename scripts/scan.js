/**
 * Standalone GreenField scanner — runs outside VS Code
 * Usage: node scripts/scan.js <directory>
 */
const path = require('path');
const fs = require('fs');
const { mapEndpoints } = require('../dist-test/src/endpointMapper');
const { extractFields } = require('../dist-test/src/parsers/typescript/fieldExtractor');
const { trackUsage } = require('../dist-test/src/parsers/typescript/usageTracker');

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
const fileContents = files.map(f => ({ path: f, content: fs.readFileSync(f, 'utf8') }));

console.log(`\n📂  Scanned ${files.length} TypeScript files in ${path.resolve(targetDir)}\n`);

// 1. Endpoint mapping
const endpoints = mapEndpoints(fileContents);
console.log(`🔗  Endpoints detected: ${endpoints.length}`);
endpoints.forEach(e => {
  console.log(`    ${e.pattern}`);
  if (e.backendFile) console.log(`       backend:  ${path.relative(targetDir, e.backendFile)}`);
  e.frontendFiles.forEach(f => console.log(`       frontend: ${path.relative(targetDir, f)}`));
});

// 2. Field extraction per file
console.log('\n📦  Field extraction (request bodies sent by frontend):');
let totalDefinedFields = 0;
const allDefinedByFile = {};
for (const f of files) {
  try {
    const defined = extractFields(f);
    if (defined.length > 0) {
      totalDefinedFields += defined.length;
      allDefinedByFile[f] = defined;
      console.log(`    ${path.relative(targetDir, f)}`);
      defined.forEach(d => console.log(`       + ${d.name}  (${d.definedAt.split(':').pop()})`));
    }
  } catch(e) { /* skip unparseable */ }
}
if (totalDefinedFields === 0) console.log('    (none found)');

// 3. Usage tracking per file
console.log('\n👁️   Usage tracking (response fields accessed by frontend):');
let totalTrackedFields = 0;
const allTrackedByFile = {};
for (const f of files) {
  try {
    const tracked = trackUsage(f);
    if (tracked.length > 0) {
      totalTrackedFields += tracked.length;
      allTrackedByFile[f] = tracked;
      console.log(`    ${path.relative(targetDir, f)}: [${tracked.map(t=>t.name).join(', ')}]`);
    }
  } catch(e) { /* skip */ }
}
if (totalTrackedFields === 0) console.log('    (none found)');

// 4. Dead field diff
function computeDiff(defined, accessed) {
  const accessedNames = new Set(accessed.map(f => f.name));
  return defined.filter(f => !accessedNames.has(f.name));
}
const allAccessed = Object.values(allTrackedByFile).flat();
const FRONTEND_ACCESSED_NAMES = new Set(allAccessed.map(f => f.name));

// Backend response shapes (read from source — Person C's parser will produce this automatically)
const BACKEND_RESPONSE_FIELDS = {
  'GET /test':    ['username'],
  'POST /test':   ['_id', 'text', '__v', 'updatedAt', 'createdAt'],
  'PUT /test':    ['_id', 'text', 'n', 'nModified', 'ok'],
  'DELETE /test': ['_id', 'text'],
  'GET /extra':   ['username'],
  'POST /extra':  ['text'],
  'PUT /extra':   ['text'],
};

console.log('\n💀  Dead field analysis (backend response → frontend read):');
let backendDead = 0;
let backendTotal = 0;

for (const [ep, fieldNames] of Object.entries(BACKEND_RESPONSE_FIELDS)) {
  const dead = fieldNames.filter(n => !FRONTEND_ACCESSED_NAMES.has(n));
  const used = fieldNames.filter(n => FRONTEND_ACCESSED_NAMES.has(n));
  backendTotal += fieldNames.length;
  backendDead += dead.length;

  console.log(`\n    ${ep}`);
  console.log(`       sends:  [${fieldNames.join(', ')}]`);
  console.log(`       read:   [${used.join(', ') || 'none'}]`);
  if (dead.length > 0)
    console.log(`       ⚠️  DEAD: [${dead.join(', ')}]`);
  else
    console.log(`       ✅  all fields used`);
}

// 5. Request body dead fields (frontend sends but backend never reads)
const BACKEND_READS = {
  'POST /test':   ['text'],
  'PUT /test':    ['id', 'text'],
  'DELETE /test': ['id'],
  'POST /extra':  ['text'],
  'PUT /extra':   ['text'],
};
const allDefinedFields = Object.values(allDefinedByFile).flat();

console.log('\n📤  Dead request fields (frontend sends but backend ignores):');
let reqDead = 0;
let reqTotal = 0;
for (const [ep, backendReads] of Object.entries(BACKEND_READS)) {
  const frontendSends = allDefinedFields.map(f => f.name);
  const dead = frontendSends.filter(n => !backendReads.includes(n));
  reqTotal += frontendSends.length;
  reqDead += dead.length;
  if (frontendSends.length > 0) {
    console.log(`\n    ${ep}`);
    console.log(`       frontend sends: [${frontendSends.join(', ')}]`);
    console.log(`       backend reads:  [${backendReads.join(', ')}]`);
    if (dead.length > 0)
      console.log(`       ⚠️  DEAD:         [${dead.join(', ')}]`);
    else
      console.log(`       ✅  all sent fields consumed`);
  }
}

const totalDeadFields = backendDead;
const avgFieldBytes = 24;
const wastedBytes = totalDeadFields * avgFieldBytes;
const dailyRequests = 10000;
const co2Wh = wastedBytes * dailyRequests * 0.000000006 * 1000;

console.log('\n══════════════════════════════════════════════════════');
console.log('📊  GreenField Scan Summary — express-react-typescript');
console.log('══════════════════════════════════════════════════════');
console.log(`  Files scanned:                 ${files.length}`);
console.log(`  Endpoints mapped:              ${endpoints.length}`);
console.log(`  Frontend request fields found: ${totalDefinedFields}`);
console.log(`  Frontend access patterns:      ${totalTrackedFields}`);
console.log(`  Backend response fields total: ${backendTotal}`);
console.log(`  Dead response fields:          ${backendDead} / ${backendTotal} (${Math.round(backendDead/backendTotal*100)}%)`);
console.log(`  Est. wasted bytes/request:     ~${wastedBytes} bytes`);
console.log(`  Est. CO₂ waste @10k req/day:   ~${co2Wh.toFixed(4)} Wh/day`);
console.log('══════════════════════════════════════════════════════\n');
