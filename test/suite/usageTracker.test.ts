import * as assert from 'assert';
import * as path from 'path';
import { trackUsage } from '../../src/parsers/typescript/usageTracker';

// __dirname at runtime = dist-test/test/suite — fixtures are in the source tree
const FIXTURES = path.resolve(__dirname, '../../../test/suite/fixtures/unit');

describe('usageTracker', () => {

  let fields: ReturnType<typeof trackUsage>;
  let names: string[];

  before(() => {
    fields = trackUsage(path.join(FIXTURES, 'usagePatterns.ts'));
    names = fields.map(f => f.name);
  });

  // --- Direct property access ---
  it('tracks direct property access: "id"', () => {
    assert.ok(names.includes('id'));
  });

  it('tracks direct property access: "email"', () => {
    assert.ok(names.includes('email'));
  });

  // --- Optional chaining ---
  it('tracks optional chaining: "user"', () => {
    assert.ok(names.includes('user'));
  });

  it('tracks optional chaining leaf: "name"', () => {
    assert.ok(names.includes('name'));
  });

  it('tracks optional chaining: "profile"', () => {
    assert.ok(names.includes('profile'));
  });

  it('tracks optional chaining leaf: "url"', () => {
    assert.ok(names.includes('url'));
  });

  // --- Simple destructuring ---
  it('tracks destructured key: "username"', () => {
    assert.ok(names.includes('username'));
  });

  it('tracks destructured key: "role"', () => {
    assert.ok(names.includes('role'));
  });

  // --- Aliased destructuring — original key must be tracked, not the alias ---
  it('tracks aliased destructured key: "createdAt" (not "joinedAt")', () => {
    assert.ok(names.includes('createdAt'));
    assert.ok(!names.includes('joinedAt'));
  });

  // --- Nested destructuring ---
  it('tracks nested destructured key: "city"', () => {
    assert.ok(names.includes('city'));
  });

  it('tracks nested destructured key: "zipCode"', () => {
    assert.ok(names.includes('zipCode'));
  });

  // --- Template literal / JSX (resolved via property access) ---
  it('tracks JSX/template property: "displayName"', () => {
    assert.ok(names.includes('displayName'));
  });

  it('tracks template literal property: "firstName"', () => {
    assert.ok(names.includes('firstName'));
  });

  // --- Conservative rule: dynamic bracket access must NOT be tracked ---
  it('does NOT track dynamic bracket access (obj[key])', () => {
    // The variable "key" itself must not appear as a tracked field name from bracket access.
    // We verify no field was added for the identifier used as the bracket key.
    // There's no field with name equal to "key" added by the dynamic rule.
    // (Note: "key" may appear via other property accesses in the file — we check the rule holds
    //  by confirming the bracket expression didn't produce a spurious extra entry beyond what
    //  normal property traversal would find.)
    const dynamicEntries = fields.filter(f => f.name === 'dynamic');
    assert.strictEqual(dynamicEntries.length, 0, '"dynamic" should not be tracked as a field');
  });

  // --- Side is always "response" ---
  it('marks all tracked fields as side: "response"', () => {
    assert.ok(fields.every(f => f.side === 'response'));
  });

  // --- No duplicates ---
  it('does not emit duplicate field names', () => {
    const counts = new Map<string, number>();
    for (const f of fields) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
    assert.deepStrictEqual(dupes, [], `Duplicate fields: ${dupes.join(', ')}`);
  });

  // --- definedAt is populated ---
  it('attaches a definedAt location string to every tracked field', () => {
    assert.ok(fields.every(f => typeof f.definedAt === 'string' && f.definedAt.includes(':')));
  });

});
