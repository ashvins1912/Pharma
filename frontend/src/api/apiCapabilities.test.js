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

  it('requires delivery management permission to verify a delivery OTP', () => {
    assert.equal(
      resolveApiCapability('POST', '/api/orders/6accca6691b2129986259f9c/verify-delivery')?.permission,
      'delivery.manage'
    );
  });

  it('does not classify public auth APIs as protected capabilities', () => {
    assert.equal(resolveApiCapability('POST', '/api/v1/auth/login'), null);
  });

  it('permits public tenant and branch discovery without blocking customer permissions', () => {
    assert.equal(resolveApiCapability('GET', '/api/v1/tenants'), null);
    assert.equal(resolveApiCapability('GET', '/api/v1/branches'), null);
    assert.equal(resolveApiCapability('GET', '/api/tenants/nearby'), null);
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
