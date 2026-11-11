import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { requireSuperAdmin } from './authenticateUser.js';
import { createServiceToken } from './serviceAuth.js';

function runGuard(role) {
  const req = { user: { role, app_metadata: { role } }, requestId: 'test-request' };
  let nextCalled = false;
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  requireSuperAdmin(req, res, () => { nextCalled = true; });
  return { nextCalled, ...res };
}

test('catalogue import guard allows only explicit platform super admin roles', () => {
  for (const role of ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN']) {
    assert.equal(runGuard(role).nextCalled, true, role);
  }
  for (const role of ['admin', 'ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'customer']) {
    const result = runGuard(role);
    assert.equal(result.nextCalled, false, role);
    assert.equal(result.statusCode, 403, role);
    assert.equal(result.body.error.code, 'FORBIDDEN', role);
  }
});

test('service token marks only explicit platform super admins as platform users', () => {
  const gatewayConfig = {
    serviceAuthSecret: 'test-service-secret-with-more-than-thirty-two-characters',
    serviceJwtIssuer: 'test-issuer'
  };
  for (const role of ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN']) {
    const token = createServiceToken({
      audience: 'inventory-service',
      scope: 'inventory.catalogue.import',
      user: { sub: 'platform-user', role, app_metadata: { role } }
    }, gatewayConfig);
    assert.equal(jwt.decode(token).isPlatformUser, true, role);
  }
  for (const role of ['admin', 'ADMIN', 'TENANT_ADMIN']) {
    const token = createServiceToken({
      audience: 'inventory-service',
      scope: 'inventory.catalogue.import',
      user: { sub: 'tenant-user', role, app_metadata: { role } }
    }, gatewayConfig);
    assert.equal(jwt.decode(token).isPlatformUser, false, role);
  }
});
