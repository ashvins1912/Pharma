import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCheckoutIdentity } from './checkoutIdempotency.js';

test('checkout identity remains stable for retries of the same customer, tenant and key', () => {
  const input = { userId: 'customer-1', tenantId: 'tenant-1', idempotencyKey: 'attempt-1' };
  assert.deepEqual(buildCheckoutIdentity(input), buildCheckoutIdentity(input));
  assert.match(buildCheckoutIdentity(input).orderId, /^[a-f0-9]{24}$/);
});

test('checkout identity is isolated by customer, tenant and idempotency key', () => {
  const base = buildCheckoutIdentity({ userId: 'customer-1', tenantId: 'tenant-1', idempotencyKey: 'attempt-1' });
  assert.notEqual(base.orderId, buildCheckoutIdentity({ userId: 'customer-2', tenantId: 'tenant-1', idempotencyKey: 'attempt-1' }).orderId);
  assert.notEqual(base.orderId, buildCheckoutIdentity({ userId: 'customer-1', tenantId: 'tenant-2', idempotencyKey: 'attempt-1' }).orderId);
  assert.notEqual(base.orderId, buildCheckoutIdentity({ userId: 'customer-1', tenantId: 'tenant-1', idempotencyKey: 'attempt-2' }).orderId);
});

test('checkout identity rejects incomplete scope', () => {
  assert.equal(buildCheckoutIdentity({ userId: 'customer-1', tenantId: 'tenant-1' }), null);
});
