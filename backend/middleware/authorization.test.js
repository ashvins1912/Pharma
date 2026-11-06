import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, requireTenantScope } from './authorization.js';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('authorization middleware denies a revoked permission even for platform admins', async () => {
  const req = {
    authz: { role: 'SUPER_ADMIN', scope: 'PLATFORM', permissions: ['*'], revokedPermissions: ['inventory.write'] },
    requestId: 'req-test'
  };
  const res = response();
  let nextCalled = false;
  await authorize('inventory.write')(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('tenant scope policy rejects actors without tenant or platform scope', async () => {
  const req = { authz: { role: 'CUSTOMER', scope: 'CUSTOMER', tenantId: null } };
  const res = response();
  let nextCalled = false;
  await requireTenantScope()(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'TENANT_CONTEXT_REQUIRED');
});

test('tenant scope policy accepts resolved active tenant membership', async () => {
  const req = { authz: { role: 'TENANT_ADMIN', scope: 'TENANT', tenantId: 'tenant-a' } };
  const res = response();
  let nextCalled = false;
  await requireTenantScope()(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
