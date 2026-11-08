import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isActiveTenantAdmin,
  wouldRemoveLastActiveTenantAdmin
} from './tenantAdminGuard.js';

test('only active tenant-wide TENANT_ADMIN memberships count toward continuity', () => {
  assert.equal(isActiveTenantAdmin({ role: 'TENANT_ADMIN', status: 'ACTIVE' }), true);
  assert.equal(isActiveTenantAdmin({ role: 'TENANT_ADMIN', status: 'SUSPENDED' }), false);
  assert.equal(isActiveTenantAdmin({ role: 'TENANT_OWNER', status: 'ACTIVE' }), false);
});

test('last active tenant admin cannot be demoted, suspended, or revoked', () => {
  const current = { role: 'TENANT_ADMIN', status: 'ACTIVE' };
  assert.equal(wouldRemoveLastActiveTenantAdmin(current, { role: 'PHARMACY_STAFF' }, 1), true);
  assert.equal(wouldRemoveLastActiveTenantAdmin(current, { status: 'SUSPENDED' }, 1), true);
  assert.equal(wouldRemoveLastActiveTenantAdmin(current, { status: 'REVOKED' }, 1), true);
});

test('tenant admin can be changed when another active tenant admin remains', () => {
  const current = { role: 'TENANT_ADMIN', status: 'ACTIVE' };
  assert.equal(wouldRemoveLastActiveTenantAdmin(current, { status: 'SUSPENDED' }, 2), false);
  assert.equal(wouldRemoveLastActiveTenantAdmin(current, { role: 'PHARMACY_STAFF' }, 2), false);
});

test('editing branch or permissions without removing active admin status is allowed', () => {
  assert.equal(wouldRemoveLastActiveTenantAdmin(
    { role: 'TENANT_ADMIN', status: 'ACTIVE' },
    { permissions: [], branchId: null },
    1
  ), false);
});
