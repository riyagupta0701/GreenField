/**
 * Unit tests — Diff Engine + Sustainability Scorer
 *
 * Covers: computeDiff, scoreWaste, estimateFieldBytes, estimateDailyRequests,
 *         estimateCO2kWh, runDiff
 */

import * as assert from 'assert';
import { computeDiff } from '../../src/diffEngine/differ';
import { scoreWaste, estimateCO2kWh, estimateFieldBytes, estimateDailyRequests, KWH_PER_BYTE } from '../../src/diffEngine/scorer';
import { runDiff } from '../../src/diffEngine';
import { Field, FieldSet, Endpoint } from '../../src/types';

// Helpers

function field(name: string, side: 'request' | 'response' = 'response'): Field {
  return { name, side, definedAt: `test.ts:1`, wasteScore: 0 };
}

const ENDPOINT: Endpoint = {
  pattern: 'GET /api/test',
  method: 'GET',
  backendFile: 'server.ts',
  frontendFiles: ['client.ts'],
};

// computeDiff

describe('computeDiff', () => {
  it('returns all defined fields when none are accessed', () => {
    const defined  = [field('id'), field('name'), field('secret')];
    const accessed: Field[] = [];
    const dead = computeDiff(defined, accessed);
    assert.deepStrictEqual(dead.map(f => f.name), ['id', 'name', 'secret']);
  });

  it('returns empty array when all defined fields are accessed', () => {
    const defined  = [field('id'), field('name')];
    const accessed = [field('id'), field('name')];
    const dead = computeDiff(defined, accessed);
    assert.strictEqual(dead.length, 0);
  });

  it('returns only the unaccessed fields', () => {
    const defined  = [field('id'), field('name'), field('email'), field('lastLoginIp')];
    const accessed = [field('id'), field('name')];
    const dead = computeDiff(defined, accessed);
    assert.deepStrictEqual(dead.map(f => f.name).sort(), ['email', 'lastLoginIp']);
  });

  it('returns empty array when both inputs are empty', () => {
    assert.strictEqual(computeDiff([], []).length, 0);
  });

  it('ignores extra accessed fields not in defined (no crash, no false positives)', () => {
    const defined  = [field('id')];
    const accessed = [field('id'), field('phantom')];
    const dead = computeDiff(defined, accessed);
    assert.strictEqual(dead.length, 0);
  });

  it('treats field names case-sensitively', () => {
    const defined  = [field('Email')];
    const accessed = [field('email')];        // different case
    const dead = computeDiff(defined, accessed);
    assert.strictEqual(dead.length, 1);
    assert.strictEqual(dead[0].name, 'Email');
  });

  it('preserves field metadata on dead fields', () => {
    const f: Field = { name: 'secret', side: 'response', definedAt: 'server.ts:42', wasteScore: 0 };
    const dead = computeDiff([f], []);
    assert.strictEqual(dead[0].definedAt, 'server.ts:42');
    assert.strictEqual(dead[0].side, 'response');
  });

  it('works for request-side fields', () => {
    const defined  = [field('customerId', 'request'), field('shippingAddress', 'request')];
    const accessed = [field('customerId', 'request')];
    const dead = computeDiff(defined, accessed);
    assert.deepStrictEqual(dead.map(f => f.name), ['shippingAddress']);
  });
});

// estimateFieldBytes

describe('estimateFieldBytes', () => {
  it('assigns ~5 bytes to boolean-named fields', () => {
    assert.strictEqual(estimateFieldBytes('isActive'), 5);
    assert.strictEqual(estimateFieldBytes('hasPermission'), 5);
  });

  it('assigns ~38 bytes to UUID fields', () => {
    assert.strictEqual(estimateFieldBytes('userId'), 38);
    assert.strictEqual(estimateFieldBytes('recordUuid'), 38);
  });

  it('assigns ~26 bytes to timestamp fields', () => {
    assert.strictEqual(estimateFieldBytes('createdAt'), 26);
    assert.strictEqual(estimateFieldBytes('updatedAt'), 26);
  });

  it('assigns ~27 bytes to email fields', () => {
    assert.strictEqual(estimateFieldBytes('email'), 27);
    assert.strictEqual(estimateFieldBytes('userEmail'), 27);
  });

  it('assigns ~52 bytes to URL fields', () => {
    assert.strictEqual(estimateFieldBytes('avatarUrl'), 52);
    assert.strictEqual(estimateFieldBytes('profileLink'), 52);
  });

  it('assigns ~66 bytes to token/hash fields', () => {
    assert.strictEqual(estimateFieldBytes('accessToken'), 66);
    assert.strictEqual(estimateFieldBytes('passwordHash'), 66);
  });

  it('returns a positive number for any field name', () => {
    const names = ['x', 'foo', 'someRandomField', 'a1b2c3'];
    for (const n of names) {
      assert.ok(estimateFieldBytes(n) > 0, `expected positive bytes for "${n}"`);
    }
  });
});

// estimateDailyRequests

describe('estimateDailyRequests', () => {
  it('returns high volume for health-check endpoints', () => {
    assert.ok(estimateDailyRequests('GET /health') > 50_000);
    assert.ok(estimateDailyRequests('GET /ping') > 50_000);
  });

  it('returns elevated volume for auth endpoints', () => {
    const auth = estimateDailyRequests('POST /api/login');
    const general = estimateDailyRequests('GET /api/users');
    assert.ok(auth > general);
  });

  it('returns low volume for admin endpoints', () => {
    const admin = estimateDailyRequests('GET /admin/users');
    const general = estimateDailyRequests('GET /api/users');
    assert.ok(admin < general);
  });

  it('returns lower volume for write endpoints than reads', () => {
    const write = estimateDailyRequests('POST /api/orders');
    const read  = estimateDailyRequests('GET /api/orders');
    assert.ok(write < read);
  });

  it('returns 10,000 for a generic endpoint', () => {
    assert.strictEqual(estimateDailyRequests('GET /api/products'), 10_000);
  });

  it('returns 10,000 when no pattern is provided', () => {
    assert.strictEqual(estimateDailyRequests(undefined), 10_000);
  });
});

// scoreWaste

describe('scoreWaste', () => {
  it('returns a positive number for any field', () => {
    assert.ok(scoreWaste(field('email')) > 0);
  });

  it('uses email byte estimate × default daily requests', () => {
    const expected = estimateFieldBytes('email') * estimateDailyRequests('GET /api/test');
    assert.strictEqual(scoreWaste(field('email'), 'GET /api/test'), expected);
  });

  it('produces higher scores for health endpoints than admin endpoints', () => {
    const health = scoreWaste(field('version'), 'GET /health');
    const admin  = scoreWaste(field('version'), 'GET /admin/users');
    assert.ok(health > admin);
  });

  it('produces higher scores for URL fields than boolean fields', () => {
    const url  = scoreWaste(field('avatarUrl'));
    const bool = scoreWaste(field('isActive'));
    assert.ok(url > bool);
  });
});

// estimateCO2kWh

describe('estimateCO2kWh', () => {
  it('uses the Aslan 2018 coefficient: 0.06 kWh/GB = 6e-11 kWh/byte', () => {
    assert.strictEqual(KWH_PER_BYTE, 6e-11);
    const result = estimateCO2kWh(1_000_000_000); // 1 GB
    assert.strictEqual(result, 0.06);             // Should equal 0.06 kWh
  });

  it('returns 0 for 0 wasted bytes', () => {
    assert.strictEqual(estimateCO2kWh(0), 0);
  });

  it('is proportional to wasted bytes', () => {
    const a = estimateCO2kWh(500);
    const b = estimateCO2kWh(1000);
    assert.strictEqual(b / a, 2);
  });
});

// runDiff

describe('runDiff', () => {
  it('returns a FieldSet with deadFields populated', () => {
    const fs: FieldSet = {
      endpoint:      ENDPOINT,
      definedFields:  [field('id'), field('name'), field('secret')],
      accessedFields: [field('id'), field('name')],
    };
    const result = runDiff(fs);
    assert.ok(result.deadFields, 'deadFields should be set');
    assert.deepStrictEqual(result.deadFields!.map(f => f.name), ['secret']);
  });

  it('attaches a positive wasteScore to each dead field', () => {
    const fs: FieldSet = {
      endpoint:      ENDPOINT,
      definedFields:  [field('secret')],
      accessedFields: [],
    };
    const result = runDiff(fs);
    assert.ok(result.deadFields![0].wasteScore! > 0);
  });

  it('wasteScore reflects field name and endpoint pattern', () => {
    const fs: FieldSet = {
      endpoint:      ENDPOINT,
      definedFields:  [field('accessToken')],
      accessedFields: [],
    };
    const result = runDiff(fs);
    const expected = estimateFieldBytes('accessToken') * estimateDailyRequests(ENDPOINT.pattern);
    assert.strictEqual(result.deadFields![0].wasteScore, expected);
  });

  it('returns empty deadFields when all fields are accessed', () => {
    const fs: FieldSet = {
      endpoint:      ENDPOINT,
      definedFields:  [field('id'), field('name')],
      accessedFields: [field('id'), field('name')],
    };
    const result = runDiff(fs);
    assert.strictEqual(result.deadFields!.length, 0);
  });

  it('does not mutate the original FieldSet', () => {
    const original: FieldSet = {
      endpoint:      ENDPOINT,
      definedFields:  [field('id')],
      accessedFields: [],
    };
    runDiff(original);
    assert.strictEqual(original.deadFields, undefined);
  });

  it('preserves all original FieldSet properties', () => {
    const fs: FieldSet = {
      endpoint:      ENDPOINT,
      definedFields:  [field('id')],
      accessedFields: [field('id')],
    };
    const result = runDiff(fs);
    assert.strictEqual(result.endpoint, ENDPOINT);
    assert.strictEqual(result.definedFields, fs.definedFields);
    assert.strictEqual(result.accessedFields, fs.accessedFields);
  });
});
