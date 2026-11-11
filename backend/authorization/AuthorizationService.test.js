import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthorizationService } from './AuthorizationService.js';
import { tenantService } from '../services/tenant-service/TenantService.js';

test('branch staff membership permissions are a ceiling over role catalog grants', async () => {
  const original = tenantService.getMembershipsForUser;
  tenantService.getMembershipsForUser = async () => [{
    id: 'membership-staff-ceiling-test',
    userId: 'staff-user',
    tenantId: 'tenant-ceiling-test',
    branchId: 'branch-ceiling-test',
    role: 'PHARMACY_STAFF',
    permissions: ['orders.read'],
    status: 'ACTIVE'
  }];
  try {
    const context = await new AuthorizationService().resolve({
      sub: 'staff-user',
      tenantId: 'tenant-ceiling-test',
      role: 'CUSTOMER'
    });
    assert.deepEqual(context.permissions, ['orders.read']);
    assert.equal(context.permissions.includes('prescription.read'), false);
    assert.equal(context.permissions.includes('prescription.write'), false);
    assert.equal(context.permissions.includes('promotions.manage'), false);
  } finally {
    tenantService.getMembershipsForUser = original;
  }
});
