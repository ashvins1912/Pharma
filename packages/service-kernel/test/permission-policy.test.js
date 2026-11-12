import test from 'node:test';
import assert from 'node:assert/strict';
import { isPermissionGranted } from '../src/authorization/PermissionPolicy.js';

test('explicit revocation overrides wildcard and platform role grants', () => {
  assert.equal(isPermissionGranted({
    subject: { role: 'SUPER_ADMIN', permissions: ['*'], revokedPermissions: ['inventory.write'] },
    permission: 'inventory.write'
  }), false);
  assert.equal(isPermissionGranted({
    subject: { role: 'TENANT_ADMIN', permissions: ['inventory.*'], revokedPermissions: ['inventory.write'] },
    permission: 'inventory.write'
  }), false);
});

test('supports canonical permissions, aliases and wildcard grants', () => {
  assert.equal(isPermissionGranted({ subject: { permissions: ['inventory.view'] }, permission: 'inventory.read', aliases: { 'inventory.read': ['inventory.view'] } }), true);
  assert.equal(isPermissionGranted({ subject: { permissions: ['inventory.*'] }, permission: 'inventory.write' }), true);
  assert.equal(isPermissionGranted({ subject: { permissions: ['orders.read'] }, permission: 'orders.manage' }), false);
});

test('supports scoped role exceptions only after deny evaluation', () => {
  const options = {
    subject: { role: 'TENANT_ADMIN', revokedPermissions: ['tenant.branches.manage'] },
    permission: 'tenant.branches.manage',
    roleOverrides: { TENANT_ADMIN: ['tenant.branches.manage'] }
  };
  assert.equal(isPermissionGranted(options), false);
  assert.equal(isPermissionGranted({ ...options, subject: { role: 'TENANT_ADMIN' } }), true);
});

test('customer defaults are explicit and do not grant unrelated permissions', () => {
  assert.equal(isPermissionGranted({ subject: { role: 'CUSTOMER' }, permission: 'orders.create', customerDefaultPermissions: ['orders.create'] }), true);
  assert.equal(isPermissionGranted({ subject: { role: 'CUSTOMER' }, permission: 'inventory.write', customerDefaultPermissions: ['orders.create'] }), false);
});
