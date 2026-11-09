import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiCapability } from './apiCapabilities.js';

describe('API capability registry', () => {
  it('requires permissions for protected medicine request APIs', () => {
    assert.equal(
      resolveApiCapability('GET', '/api/admin/medicine-requests/pending-count')?.permission,
      'medicine_requests.pending_count'
    );
  });

  it('uses specialized permissions before generic permissions', () => {
    assert.equal(
      resolveApiCapability('POST', '/api/v1/prescriptions/123/review')?.permission,
      'prescription.review'
    );
  });

  it('requires order permissions for customer order APIs', () => {
    assert.equal(
      resolveApiCapability('POST', '/api/orders/checkout')?.permission,
      'orders.create'
    );
  });

  it('allows an assigned rider to verify a delivery OTP with delivery-read permission', () => {
    assert.equal(
      resolveApiCapability('POST', '/api/orders/6accca6691b2129986259f9c/verify-delivery')?.permission,
      'delivery.read'
    );
  });

  it('maps reveal and resend OTP to their intended roles', () => {
    assert.equal(resolveApiCapability('GET', '/api/orders/order-1/reveal-otp')?.permission, 'orders.read');
    assert.equal(resolveApiCapability('POST', '/api/orders/order-1/resend-otp')?.permission, 'orders.manage');
  });

  it('does not classify public auth APIs as protected capabilities', () => {
    assert.equal(resolveApiCapability('POST', '/api/v1/auth/login'), null);
  });

  it('permits public tenant and branch discovery without blocking customer permissions', () => {
    assert.equal(resolveApiCapability('GET', '/api/v1/tenants'), null);
    assert.equal(resolveApiCapability('GET', '/api/v1/branches'), null);
    assert.equal(resolveApiCapability('GET', '/api/tenants/nearby'), null);
  });

  it('maps tenant staff, branch approval and activity APIs to scoped permissions', () => {
    assert.equal(resolveApiCapability('GET', '/api/v1/tenants/tenant-1/memberships')?.permission, 'tenant.branches.read');
    assert.equal(resolveApiCapability('POST', '/api/v1/tenants/tenant-1/memberships')?.permission, 'tenant.branches.manage');
    assert.equal(resolveApiCapability('PATCH', '/api/v1/tenants/tenant-1/memberships/member-1')?.permission, 'tenant.branches.manage');
    assert.equal(resolveApiCapability('DELETE', '/api/v1/tenants/tenant-1/memberships/member-1')?.permission, 'tenant.branches.manage');
    assert.equal(resolveApiCapability('GET', '/api/v1/activity?page=1')?.permission, 'tenant.branches.read');
    assert.equal(resolveApiCapability('GET', '/api/tenant/branches?includePending=true')?.permission, 'tenant.branches.read');
    assert.equal(resolveApiCapability('POST', '/api/tenant/branches')?.permission, 'tenant.branches.manage');
    assert.equal(resolveApiCapability('POST', '/api/v1/branches/branch-1/activate')?.permission, 'tenant.branches.manage');
  });

  it('requires tenant management permissions for administrative tenant changes', () => {
    assert.equal(
      resolveApiCapability('POST', '/api/v1/admin/tenants')?.permission,
      'tenants.manage'
    );
    assert.equal(
      resolveApiCapability('GET', '/api/v1/admin/tenants')?.permission,
      'tenants.read'
    );
  });
});
