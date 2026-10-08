import { describe, expect, it } from 'vitest';
import { resolveApiCapability } from './apiCapabilities';

describe('API capability registry', () => {
  it('requires permissions for protected medicine request APIs', () => {
    expect(resolveApiCapability('GET', '/api/admin/medicine-requests/pending-count')?.permission)
      .toBe('medicine_requests.pending_count');
  });

  it('uses specialized permissions before generic permissions', () => {
    expect(resolveApiCapability('POST', '/api/v1/prescriptions/123/review')?.permission)
      .toBe('prescription.review');
  });

  it('requires order permissions for customer order APIs', () => {
    expect(resolveApiCapability('POST', '/api/orders/checkout')?.permission)
      .toBe('orders.create');
  });

  it('does not classify public auth APIs as protected capabilities', () => {
    expect(resolveApiCapability('POST', '/api/v1/auth/login')).toBeNull();
  });
});
