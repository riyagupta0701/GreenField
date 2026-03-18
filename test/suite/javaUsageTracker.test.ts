import * as assert from 'assert';
import * as path from 'path';
import { trackUsage } from '../../src/parsers/java/usageTracker';

const FIXTURES = path.resolve(__dirname, '../../../test/suite/fixtures/unit');

describe('javaUsageTracker', () => {

  describe('spring_controller.java — @RequestBody getter + direct access', () => {
    let fields: ReturnType<typeof trackUsage>;

    before(() => {
      fields = trackUsage(path.join(FIXTURES, 'spring_controller.java'));
    });

    it('finds "firstName" via req.getFirstName()', () => {
      assert.ok(fields.some(f => f.name === 'firstName'));
    });

    it('finds "lastName" via req.getLastName()', () => {
      assert.ok(fields.some(f => f.name === 'lastName'));
    });

    it('finds "emailAddress" via req.getEmailAddress()', () => {
      assert.ok(fields.some(f => f.name === 'emailAddress'));
    });

    it('finds "query" via @RequestParam("query")', () => {
      assert.ok(fields.some(f => f.name === 'query'));
    });

    it('finds "pageSize" via @RequestParam("pageSize")', () => {
      assert.ok(fields.some(f => f.name === 'pageSize'));
    });

    it('finds "category" via @RequestParam without explicit name', () => {
      assert.ok(fields.some(f => f.name === 'category'));
    });

    it('finds "limit" via @RequestParam without explicit name', () => {
      assert.ok(fields.some(f => f.name === 'limit'));
    });

    it('finds "authToken" via request.getParameter()', () => {
      assert.ok(fields.some(f => f.name === 'authToken'));
    });

    it('finds "clientId" via request.getParameter()', () => {
      assert.ok(fields.some(f => f.name === 'clientId'));
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
