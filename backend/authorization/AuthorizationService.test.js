import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthorizationService } from './AuthorizationService.js';

test('explicit permission revocations override wildcard and platform grants', () => {
  const service = new AuthorizationService();
  assert.equal(service.isAllowed({
    role: 'SUPER_ADMIN',
    permissions: ['*'],
    revokedPermissions: ['inventory.write']
  }, 'inventory.write'), false);
  assert.equal(service.isAllowed({
    role: 'TENANT_ADMIN',
    permissions: ['inventory.*'],
    revokedPermissions: ['inventory.write']
  }, 'inventory.write'), false);
});

test('tenant resource policy allows only the active tenant and permitted branch', () => {
  const service = new AuthorizationService();
  const actor = { role: 'TENANT_ADMIN', scope: 'TENANT', tenantId: 'tenant-a', branchId: 'branch-1' };
  assert.equal(service.canAccessTenantResource(actor, 'tenant-a', 'branch-1'), true);
  assert.equal(service.canAccessTenantResource(actor, 'tenant-b', 'branch-1'), false);
  assert.equal(service.canAccessTenantResource(actor, 'tenant-a', 'branch-2'), false);
  assert.equal(service.canAccessTenantResource(actor, 'tenant-a', null), false);
});

test('tenant-level actor may access branches within its tenant when no branch is pinned', () => {
  const service = new AuthorizationService();
  const actor = { role: 'TENANT_OWNER', scope: 'TENANT', tenantId: 'tenant-a', branchId: null };
  assert.equal(service.canAccessTenantResource(actor, 'tenant-a', 'branch-2'), true);
  assert.equal(service.canAccessTenantResource(actor, 'tenant-b', 'branch-2'), false);
});

test('platform policy is explicit and tenant-independent', () => {
  const service = new AuthorizationService();
  assert.equal(service.isPlatformContext({ role: 'SUPER_ADMIN', scope: 'PLATFORM' }), true);
  assert.equal(service.canAccessTenantResource({ role: 'SUPER_ADMIN', scope: 'PLATFORM' }, 'tenant-b', 'branch-9'), true);
  assert.equal(service.canAccessTenantResource({ role: 'CUSTOMER' }, 'tenant-b', 'branch-9'), false);
});
