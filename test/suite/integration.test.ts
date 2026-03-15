/**
 * Integration tests — full pipeline from files → endpoints → fields → dead fields
 *
 * Uses the fixtures/integration/{frontend,backend}/orders.ts files.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { mapEndpoints } from '../../src/endpointMapper';
import { extractFields } from '../../src/parsers/typescript/fieldExtractor';
import { trackUsage } from '../../src/parsers/typescript/usageTracker';
import { Field } from '../../src/types';

// __dirname at runtime = dist-test/test/suite — fixtures are in the source tree
const FIXTURE_ROOT = path.resolve(__dirname, '../../../test/suite/fixtures/integration');
const FRONTEND = path.join(FIXTURE_ROOT, 'frontend', 'orders.ts');
const BACKEND  = path.join(FIXTURE_ROOT, 'backend',  'orders.ts');

// Inline diff until Person D's implementation lands
function computeDiff(defined: Field[], accessed: Field[]): Field[] {
  const accessedNames = new Set(accessed.map(f => f.name));
  return defined.filter(f => !accessedNames.has(f.name));
}

function readFixture(p: string) {
  return { path: p, content: fs.readFileSync(p, 'utf8') };
}

// ─── Endpoint Mapper ──────────────────────────────────────────────────────────

describe('Integration — Endpoint Mapper', () => {
  let endpoints: ReturnType<typeof mapEndpoints>;

  before(() => {
    endpoints = mapEndpoints([readFixture(FRONTEND), readFixture(BACKEND)]);
  });

  it('detects at least the GET /api/orders endpoint', () => {
    assert.ok(
      endpoints.some(e => e.pattern === 'GET /api/orders'),
      `Expected "GET /api/orders" in: ${endpoints.map(e => e.pattern).join(', ')}`
    );
  });

  it('detects at least the POST /api/orders endpoint', () => {
    assert.ok(
      endpoints.some(e => e.pattern === 'POST /api/orders'),
      `Expected "POST /api/orders" in: ${endpoints.map(e => e.pattern).join(', ')}`
    );
  });

  it('links the backend file to GET /api/orders', () => {
    const ep = endpoints.find(e => e.pattern === 'GET /api/orders')!;
    assert.ok(ep.backendFile.includes('orders.ts'));
  });

  it('links the frontend file to GET /api/orders', () => {
    const ep = endpoints.find(e => e.pattern === 'GET /api/orders')!;
    assert.ok(ep.frontendFiles.some(f => f.includes('orders.ts')));
  });
});

// ─── Field Extractor (on fixture files) ──────────────────────────────────────

describe('Integration — Field Extractor on fixtures', () => {
  it('extracts request body fields from frontend POST body', () => {
    const fields = extractFields(FRONTEND);
    const names = fields.map(f => f.name);
    // Frontend sends: customerId, items, notes
    assert.ok(names.includes('customerId'), 'missing customerId');
    assert.ok(names.includes('items'),      'missing items');
    assert.ok(names.includes('notes'),      'missing notes');
  });

  it('does NOT extract fields from the backend fixture via fieldExtractor', () => {
    // fieldExtractor looks at axios/fetch/JSON.stringify call sites.
    // The backend fixture uses res.json({...}) — not an axios/fetch call.
    // So result should be empty (no request bodies sent from backend file).
    const fields = extractFields(BACKEND);
    assert.strictEqual(
      fields.length, 0,
      `Expected 0 fields from backend fixture, got: ${fields.map(f=>f.name).join(', ')}`
    );
  });
});

// ─── Usage Tracker (on fixture files) ────────────────────────────────────────

describe('Integration — Usage Tracker on fixtures', () => {
  it('tracks fields accessed by frontend from GET /api/orders response', () => {
    const accessed = trackUsage(FRONTEND);
    const names = accessed.map(f => f.name);
    // Frontend destructures: { id, total, status }
    assert.ok(names.includes('id'),     'missing id');
    assert.ok(names.includes('total'),  'missing total');
    assert.ok(names.includes('status'), 'missing status');
  });

  it('does NOT track "createdAt" as accessed by frontend', () => {
    const accessed = trackUsage(FRONTEND);
    // Frontend never reads createdAt — it should be dead
    assert.ok(!accessed.map(f => f.name).includes('createdAt'));
  });
});

// ─── Dead Field Diff ──────────────────────────────────────────────────────────

describe('Integration — Dead field detection (inline diff)', () => {
  /**
   * We simulate the pipeline:
   *   1. Backend defines response fields in res.json({...})
   *      We hand-build these as Field objects (since Person C owns backend extraction).
   *   2. Frontend accesses a subset → tracked by usageTracker.
   *   3. Diff reveals the dead fields.
   */

  const BACKEND_RESPONSE_FIELDS: Field[] = [
    { name: 'id',          side: 'response', definedAt: `${BACKEND}:9`,  wasteScore: 0 },
    { name: 'total',       side: 'response', definedAt: `${BACKEND}:10`, wasteScore: 0 },
    { name: 'status',      side: 'response', definedAt: `${BACKEND}:11`, wasteScore: 0 },
    { name: 'createdAt',   side: 'response', definedAt: `${BACKEND}:12`, wasteScore: 0 },
    { name: 'customerId',  side: 'response', definedAt: `${BACKEND}:13`, wasteScore: 0 },
    { name: 'notes',       side: 'response', definedAt: `${BACKEND}:14`, wasteScore: 0 },
    { name: 'internalRef', side: 'response', definedAt: `${BACKEND}:15`, wasteScore: 0 },
  ];

  let deadFields: Field[];

  before(() => {
    const accessed = trackUsage(FRONTEND);
    deadFields = computeDiff(BACKEND_RESPONSE_FIELDS, accessed);
  });

  it('flags "createdAt" as dead', () => {
    assert.ok(deadFields.some(f => f.name === 'createdAt'));
  });

  it('flags "customerId" as dead (backend response field, never read by frontend)', () => {
    assert.ok(deadFields.some(f => f.name === 'customerId'));
  });

  it('flags "notes" as dead (defined in response but never read)', () => {
    assert.ok(deadFields.some(f => f.name === 'notes'));
  });

  it('flags "internalRef" as dead', () => {
    assert.ok(deadFields.some(f => f.name === 'internalRef'));
  });

  it('does NOT flag "id" as dead', () => {
    assert.ok(!deadFields.some(f => f.name === 'id'));
  });

  it('does NOT flag "total" as dead', () => {
    assert.ok(!deadFields.some(f => f.name === 'total'));
  });

  it('does NOT flag "status" as dead', () => {
    assert.ok(!deadFields.some(f => f.name === 'status'));
  });

  it('finds exactly 4 dead response fields', () => {
    assert.strictEqual(deadFields.length, 4,
      `Dead fields: ${deadFields.map(f => f.name).join(', ')}`
    );
  });
});
