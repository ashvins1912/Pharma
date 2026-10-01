import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

process.env.SERVICE_AUTH_SECRET ||= 'test-service-auth-secret-must-be-at-least-32-characters';
const { normalizeCreateRequest } = await import('./src/orders.js');
const { createInventoryToken, requireOrderScope } = await import('./src/service-auth.js');
const { config } = await import('./src/config.js');

test('normalizes order items and generates a stable request fingerprint', () => {
  const first = normalizeCreateRequest({
    source: 'POS',
    externalReference: 'POS-100',
    items: [{ sku: 'med-1', quantity: 1 }, { productId: 'MED-1', quantity: 2 }],
    deliveryAddress: '  Main Street  '
  }, 'user-1');
  const replay = normalizeCreateRequest({
    source: 'POS',
    externalReference: 'POS-100',
    items: [{ sku: 'MED-1', quantity: 3 }],
    deliveryAddress: 'Main Street'
  }, 'user-1');
  assert.deepEqual(first.items, [['MED-1', 3]]);
  assert.equal(first.requestFingerprint, replay.requestFingerprint);
});

test('rejects unsupported order sources, empty idempotency, and invalid quantities', () => {
  assert.throws(() => normalizeCreateRequest({
    source: 'UNKNOWN',
    idempotencyKey: 'key',
    items: [{ sku: 'MED-1', quantity: 1 }],
    deliveryAddress: 'Main Street'
  }, 'user-1'), { statusCode: 400 });
  assert.throws(() => normalizeCreateRequest({
    items: [{ sku: 'MED-1', quantity: 1 }],
    deliveryAddress: 'Main Street'
  }, 'user-1'), { statusCode: 400 });
  assert.throws(() => normalizeCreateRequest({
    idempotencyKey: 'key',
    items: [{ sku: 'MED-1', quantity: 0 }],
    deliveryAddress: 'Main Street'
  }, 'user-1'), { statusCode: 400 });
});

test('Inventory service credentials are limited to supported scopes', () => {
  assert.throws(() => createInventoryToken(['inventory.adjust'], 'user-1'));
  assert.doesNotThrow(() => createInventoryToken(['inventory.read'], 'order-service'));
});

test('Order Service requires valid scopes from its gateway identity', async () => {
  const invokeScope = token => new Promise(resolve => {
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    const request = {
      get: () => `Bearer ${token}`,
      service: undefined
    };
    requireOrderScope('orders.manage')(request, response, () => resolve({ status: 200, user: request.service }));
  });
  const token = scope => jwt.sign({
    scope,
    userId: 'user-1',
    userRole: 'admin'
  }, config.serviceAuthSecret, {
    algorithm: 'HS256',
    subject: 'api-gateway',
    issuer: config.serviceJwtIssuer,
    audience: config.serviceJwtAudience,
    expiresIn: 60
  });
  const denied = await invokeScope(token('orders.read'));
  assert.equal(denied.status, 403);
  const allowed = await invokeScope(token('orders.manage'));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.user.userId, 'user-1');
});
