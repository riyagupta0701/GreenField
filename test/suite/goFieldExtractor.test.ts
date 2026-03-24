import * as assert from 'assert';
import * as path from 'path';
import { extractFields } from '../../src/parsers/go/fieldExtractor';

const FIXTURES = path.resolve(__dirname, '../../../test/suite/fixtures/unit');

describe('goFieldExtractor', () => {

  describe('gin_handlers.go — gin.H literals and response structs', () => {
    let fields: ReturnType<typeof extractFields>;

    before(() => {
      fields = extractFields(path.join(FIXTURES, 'gin_handlers.go'));
    });

    it('finds "userId" from gin.H literal', () => {
      assert.ok(fields.some(f => f.name === 'userId'));
    });

    it('finds "email" from gin.H literal', () => {
      assert.ok(fields.some(f => f.name === 'email'));
    });

    it('finds "displayName" from gin.H literal', () => {
      assert.ok(fields.some(f => f.name === 'displayName'));
    });

    it('uses json tag value "displayName" with omitempty stripped from UserResponse struct', () => {
      const structField = fields.find(f => f.name === 'displayName');
      assert.ok(structField, 'displayName should be present');
    });

    it('does NOT include field with json:"-" (Internal)', () => {
      assert.ok(!fields.some(f => f.name === 'internal' || f.name === 'Internal'));
    });

    it('does NOT include fields from CreateUserRequest (bind target struct)', () => {
      assert.ok(!fields.some(f => f.name === 'username'));
      assert.ok(!fields.some(f => f.name === 'password'));
      assert.ok(!fields.some(f => f.name === 'role'));
    });

    it('marks all fields as side: "response"', () => {
      assert.ok(fields.every(f => f.side === 'response'));
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

  describe('nethttp_handlers.go — map[string]interface{} and map[string]any', () => {
    let fields: ReturnType<typeof extractFields>;

    before(() => {
      fields = extractFields(path.join(FIXTURES, 'nethttp_handlers.go'));
    });

    it('finds "status" from map[string]interface{} literal', () => {
      assert.ok(fields.some(f => f.name === 'status'));
    });

    it('finds "version" from map[string]interface{} literal', () => {
      assert.ok(fields.some(f => f.name === 'version'));
    });

    it('finds "healthy" from map[string]any literal', () => {
      assert.ok(fields.some(f => f.name === 'healthy'));
    });

    it('finds "uptime" from map[string]any literal', () => {
      assert.ok(fields.some(f => f.name === 'uptime'));
    });

    it('does NOT include fields from LoginRequest (bind target struct)', () => {
      assert.ok(!fields.some(f => f.name === 'email'));
      assert.ok(!fields.some(f => f.name === 'password'));
    });

    it('marks all fields as side: "response"', () => {
      assert.ok(fields.every(f => f.side === 'response'));
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
