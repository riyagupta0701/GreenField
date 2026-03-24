import * as assert from 'assert';
import * as path from 'path';
import { trackUsage } from '../../src/parsers/go/usageTracker';

const FIXTURES = path.resolve(__dirname, '../../../test/suite/fixtures/unit');

describe('goUsageTracker', () => {

  describe('gin_handlers.go — ShouldBindJSON struct binding + Query/PostForm', () => {
    let fields: ReturnType<typeof trackUsage>;

    before(() => {
      fields = trackUsage(path.join(FIXTURES, 'gin_handlers.go'));
    });

    it('finds "username" via ShouldBindJSON → CreateUserRequest struct', () => {
      assert.ok(fields.some(f => f.name === 'username'));
    });

    it('finds "password" via ShouldBindJSON → CreateUserRequest struct', () => {
      assert.ok(fields.some(f => f.name === 'password'));
    });

    it('finds "role" via ShouldBindJSON → CreateUserRequest struct', () => {
      assert.ok(fields.some(f => f.name === 'role'));
    });

    it('finds "page" via c.Query()', () => {
      assert.ok(fields.some(f => f.name === 'page'));
    });

    it('finds "category" via c.PostForm()', () => {
      assert.ok(fields.some(f => f.name === 'category'));
    });

    it('marks all fields as side: "request"', () => {
      assert.ok(fields.every(f => f.side === 'request'));
    });

    it('attaches a definedAt location string', () => {
      assert.ok(fields.every(f => typeof f.definedAt === 'string' && f.definedAt.length > 0));
    });

    it('deduplicates fields by name + location', () => {
      const keys = fields.map(f => `${f.name}:${f.definedAt}`);
      const unique = new Set(keys);
      assert.strictEqual(keys.length, unique.size);
    });
  });

  describe('nethttp_handlers.go — Decode struct binding + Query/FormValue', () => {
    let fields: ReturnType<typeof trackUsage>;

    before(() => {
      fields = trackUsage(path.join(FIXTURES, 'nethttp_handlers.go'));
    });

    it('finds "email" via json.Decode → LoginRequest struct', () => {
      assert.ok(fields.some(f => f.name === 'email'));
    });

    it('finds "password" via json.Decode → LoginRequest struct', () => {
      assert.ok(fields.some(f => f.name === 'password'));
    });

    it('finds "search" via r.URL.Query().Get()', () => {
      assert.ok(fields.some(f => f.name === 'search'));
    });

    it('finds "filter" via r.FormValue()', () => {
      assert.ok(fields.some(f => f.name === 'filter'));
    });

    it('marks all fields as side: "request"', () => {
      assert.ok(fields.every(f => f.side === 'request'));
    });

    it('attaches a definedAt location string', () => {
      assert.ok(fields.every(f => typeof f.definedAt === 'string' && f.definedAt.length > 0));
    });

    it('deduplicates fields by name + location', () => {
      const keys = fields.map(f => `${f.name}:${f.definedAt}`);
      const unique = new Set(keys);
      assert.strictEqual(keys.length, unique.size);
    });
  });

});
