import * as assert from 'assert';
import * as path from 'path';
import { extractFields } from '../../src/parsers/java/fieldExtractor';

const FIXTURES = path.resolve(__dirname, '../../../test/suite/fixtures/unit');

describe('javaFieldExtractor', () => {

  describe('spring_dto.java — DTO fields and Map patterns', () => {
    let fields: ReturnType<typeof extractFields>;

    before(() => {
      fields = extractFields(path.join(FIXTURES, 'spring_dto.java'));
    });

    it('finds "firstName" DTO field', () => {
      assert.ok(fields.some(f => f.name === 'firstName'));
    });

    it('finds "lastName" DTO field', () => {
      assert.ok(fields.some(f => f.name === 'lastName'));
    });

    it('finds "emailAddress" DTO field', () => {
      assert.ok(fields.some(f => f.name === 'emailAddress'));
    });

    it('finds "age" DTO field', () => {
      assert.ok(fields.some(f => f.name === 'age'));
    });

    it('uses @JsonProperty value "phone_number" instead of Java identifier "phoneNumber"', () => {
      assert.ok(fields.some(f => f.name === 'phone_number'));
      // Java identifier should NOT appear separately
      assert.ok(!fields.some(f => f.name === 'phoneNumber'));
    });

    it('uses @JsonProperty value "date_of_birth" instead of Java identifier "dateOfBirth"', () => {
      assert.ok(fields.some(f => f.name === 'date_of_birth'));
    });

    it('finds "displayName" from Map.of()', () => {
      assert.ok(fields.some(f => f.name === 'displayName'));
    });

    it('finds "userId" from .put()', () => {
      assert.ok(fields.some(f => f.name === 'userId'));
    });

    it('does NOT include "serialVersionUID" (ALL_CAPS constant)', () => {
      assert.ok(!fields.some(f => f.name === 'serialVersionUID'));
    });

    it('does NOT include "logger" (noise name)', () => {
      assert.ok(!fields.some(f => f.name === 'logger'));
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
