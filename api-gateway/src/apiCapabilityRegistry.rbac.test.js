import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGatewayCapability } from './apiCapabilityRegistry.js';

test('API Gateway registers least-privilege capabilities for /api/v1/admin/rbac endpoints', () => {
  assert.equal(resolveGatewayCapability('GET', '/api/v1/admin/rbac/code-catalog'), 'users.read');
  assert.equal(resolveGatewayCapability('GET', '/api/v1/admin/rbac/history'), 'users.read');
  assert.equal(resolveGatewayCapability('POST', '/api/v1/admin/rbac/preview-diff'), 'users.manage');
  assert.equal(resolveGatewayCapability('PUT', '/api/v1/admin/rbac/code-catalog'), 'users.manage');
  assert.equal(resolveGatewayCapability('POST', '/api/v1/admin/rbac/redeploy'), 'users.manage');
  assert.equal(resolveGatewayCapability('POST', '/api/v1/admin/rbac/rollback'), 'users.manage');
  assert.equal(resolveGatewayCapability('GET', '/api/v1/admin/rbac/governance/roles'), 'users.read');
  assert.equal(resolveGatewayCapability('GET', '/api/v1/admin/rbac/governance/users'), 'users.read');
  assert.equal(resolveGatewayCapability('GET', '/api/v1/admin/rbac/governance/activity-logs'), 'users.read');
  assert.equal(resolveGatewayCapability('PATCH', '/api/v1/admin/rbac/governance/users/user-1/role'), 'users.manage');
  assert.equal(resolveGatewayCapability('PUT', '/api/v1/admin/rbac/governance/roles/PHARMACY_STAFF/permissions'), 'users.manage');
});
