import * as assert from 'assert';
import * as path from 'path';
import { extractFields } from '../../src/parsers/typescript/fieldExtractor';

// __dirname at runtime = dist-test/test/suite — fixtures are in the source tree
const FIXTURES = path.resolve(__dirname, '../../../test/suite/fixtures/unit');

describe('fieldExtractor', () => {

  describe('axios POST body', () => {
    let fields: ReturnType<typeof extractFields>;

    before(() => {
      fields = extractFields(path.join(FIXTURES, 'axiosPost.ts'));
    });

    it('extracts all four fields', () => {
      assert.strictEqual(fields.length, 4);
    });

    it('finds "username"', () => {
      assert.ok(fields.some(f => f.name === 'username'));
    });

    it('finds "email"', () => {
      assert.ok(fields.some(f => f.name === 'email'));
    });

    it('finds "password"', () => {
      assert.ok(fields.some(f => f.name === 'password'));
    });

    it('finds "role"', () => {
      assert.ok(fields.some(f => f.name === 'role'));
    });

    it('marks all fields as side: "request"', () => {
      assert.ok(fields.every(f => f.side === 'request'));
    });

    it('attaches a definedAt location string', () => {
      assert.ok(fields.every(f => typeof f.definedAt === 'string' && f.definedAt.length > 0));
    });
  });

  describe('fetch POST with JSON.stringify body', () => {
    let fields: ReturnType<typeof extractFields>;

    before(() => {
      fields = extractFields(path.join(FIXTURES, 'fetchPost.ts'));
    });

    it('extracts all four fields', () => {
      assert.strictEqual(fields.length, 4);
    });

    it('finds "name"', () => {
      assert.ok(fields.some(f => f.name === 'name'));
    });

    it('finds "price"', () => {
      assert.ok(fields.some(f => f.name === 'price'));
    });

    it('finds "sku"', () => {
      assert.ok(fields.some(f => f.name === 'sku'));
    });

    it('finds "inStock"', () => {
      assert.ok(fields.some(f => f.name === 'inStock'));
    });

    it('marks all fields as side: "request"', () => {
      assert.ok(fields.every(f => f.side === 'request'));
    });
  });

});
