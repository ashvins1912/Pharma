import test from 'node:test';
import assert from 'node:assert/strict';
import { auditMutation, queryActivity } from './activityAudit.js';

function response() {
  let finish;
  return {
    statusCode: 201,
    once(event, callback) { if (event === 'finish') finish = callback; },
    finish() { finish?.(); }
  };
}

test('customer-supplied tenant IDs are not used as audit tenant scope', async () => {
  const tenantId = 'untrusted-audit-tenant-' + Math.random().toString(36).slice(2);
  const req = {
    method: 'POST',
    originalUrl: '/api/v1/customers/me/addresses',
    path: '/api/v1/customers/me/addresses',
    body: { tenantId },
    params: {},
    query: {},
    user: { sub: 'audit-customer-test' },
    context: { tenantId, role: 'CUSTOMER', requestId: 'audit-untrusted-scope-test' },
    get() { return null; }
  };
  const res = response();
  auditMutation(req, res, () => {});
  res.finish();
  const result = await queryActivity({ tenantId });
  assert.equal(result.items.some(item => item.requestId === 'audit-untrusted-scope-test'), false);
});

test('order fulfillment preview is excluded from mutation audit', async () => {
  const req = {
    method: 'POST',
    originalUrl: '/api/orders/fulfillment/preview',
    path: '/api/orders/fulfillment/preview',
    body: {},
    params: {},
    query: {},
    user: { sub: 'audit-preview-test' },
    context: { requestId: 'audit-preview-test' }
  };
  const res = response();
  auditMutation(req, res, () => {});
  res.finish();
  const result = await queryActivity({});
  assert.equal(result.items.some(item => item.requestId === 'audit-preview-test'), false);
});
