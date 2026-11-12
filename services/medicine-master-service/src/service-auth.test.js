import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import test from 'node:test';

process.env.SERVICE_AUTH_SECRET = 'medicine-master-auth-test-secret-at-least-32-characters';
process.env.SERVICE_JWT_ISSUER = 'ashvin-pharmacy';
process.env.MEDICINE_MASTER_SERVICE_JWT_AUDIENCE = 'medicine-master-service';

const { requireServiceScope } = await import('./service-auth.js');
const secret = process.env.SERVICE_AUTH_SECRET;
const sign = (claims = {}, options = {}) => jwt.sign({
  scope: 'inventory.catalogue.read',
  userId: 'user-123',
  userRole: 'PLATFORM_SUPER_ADMIN',
  ...claims
}, secret, {
  algorithm: 'HS256',
  subject: 'api-gateway',
  issuer: 'ashvin-pharmacy',
  audience: 'medicine-master-service',
  expiresIn: 60,
  ...options
});
const invoke = token => {
  const req = { get: name => name.toLowerCase() === 'authorization' ? (token ? `Bearer ${token}` : '') : '' };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let nextCalled = false;
  requireServiceScope('inventory.catalogue.read')(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
};

test('rejects missing service credentials', () => {
  const result = invoke('');
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
});

test('rejects expired service credentials', () => {
  const token = sign({}, { expiresIn: -1 });
  assert.equal(invoke(token).res.statusCode, 401);
});

test('rejects a token with the wrong audience', () => {
  const token = sign({}, { audience: 'inventory-service' });
  assert.equal(invoke(token).res.statusCode, 401);
});

test('rejects a valid gateway signature without user identity context', () => {
  const token = sign({ userId: '' });
  const result = invoke(token);
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('rejects a valid caller without the required scope', () => {
  const token = sign({ scope: 'inventory.catalogue.import' });
  const result = invoke(token);
  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
});

test('accepts a valid gateway token with the required scope and user context', () => {
  const result = invoke(sign());
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.service.userId, 'user-123');
  assert.equal(result.req.service.isPlatformUser, false);
});
