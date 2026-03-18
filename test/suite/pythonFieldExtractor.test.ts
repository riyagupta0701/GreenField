import * as assert from 'assert';
import * as path from 'path';
import { extractFields } from '../../src/parsers/python/fieldExtractor';

const FIXTURES = path.resolve(__dirname, '../../../test/suite/fixtures/unit');

describe('pythonFieldExtractor', () => {

  describe('flask_views.py — jsonify and direct dict returns', () => {
    let fields: ReturnType<typeof extractFields>;

    before(() => {
      fields = extractFields(path.join(FIXTURES, 'flask_views.py'));
    });

    it('finds "userId" from jsonify', () => {
      assert.ok(fields.some(f => f.name === 'userId'));
    });

    it('finds "email" from jsonify', () => {
      assert.ok(fields.some(f => f.name === 'email'));
    });

    it('finds "displayName" from jsonify', () => {
      assert.ok(fields.some(f => f.name === 'displayName'));
    });

    it('finds "itemId" from direct dict return', () => {
      assert.ok(fields.some(f => f.name === 'itemId'));
    });

    it('finds "price" from direct dict return', () => {
      assert.ok(fields.some(f => f.name === 'price'));
    });

    it('marks all fields as side: "response"', () => {
      assert.ok(fields.every(f => f.side === 'response'));
    });

    it('attaches a definedAt location string', () => {
      assert.ok(fields.every(f => typeof f.definedAt === 'string' && f.definedAt.length > 0));
    });

    it('deduplicates fields', () => {
      const names = fields.map(f => f.name);
      const unique = new Set(names);
      assert.strictEqual(names.length, unique.size);
    });
  });

  describe('fastapi_routes.py — JSONResponse and Pydantic BaseModel', () => {
    let fields: ReturnType<typeof extractFields>;

    before(() => {
      fields = extractFields(path.join(FIXTURES, 'fastapi_routes.py'));
    });

    it('finds "status" from JSONResponse', () => {
      assert.ok(fields.some(f => f.name === 'status'));
    });

    it('finds "version" from JSONResponse', () => {
      assert.ok(fields.some(f => f.name === 'version'));
    });

    it('finds "healthy" from direct dict return', () => {
      assert.ok(fields.some(f => f.name === 'healthy'));
    });

    it('finds "username" Pydantic field', () => {
      assert.ok(fields.some(f => f.name === 'username'));
    });

    it('finds "userId" Pydantic response field', () => {
      assert.ok(fields.some(f => f.name === 'userId'));
    });

    it('does NOT include Pydantic noise name "model_config"', () => {
      assert.ok(!fields.some(f => f.name === 'model_config'));
    });

    it('marks response dict fields as side: "response"', () => {
      // jsonify/JSONResponse/return-dict fields are response fields
      const responseNames = ['status', 'version', 'healthy', 'uptime', 'updated'];
      const responseFields = fields.filter(f => responseNames.includes(f.name));
      assert.ok(responseFields.length > 0, 'expected some response fields');
      assert.ok(responseFields.every(f => f.side === 'response'));
    });

    it('marks Pydantic BaseModel fields as side: "request"', () => {
      // BaseModel class fields represent request body schemas
      const requestNames = ['username', 'email', 'age', 'userId', 'displayName', 'createdAt'];
      const requestFields = fields.filter(f => requestNames.includes(f.name));
      assert.ok(requestFields.length > 0, 'expected some request fields from BaseModel');
      assert.ok(requestFields.every(f => f.side === 'request'));
    });
  });

});
