import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogQuery, normalizeCatalogResponse } from './catalogMapper.js';

test('catalog query always scopes by selected tenant and includes optional branch', () => {
  assert.deepEqual(buildCatalogQuery({ tenantId: 'tenant-a', branchId: 'branch-a', page: 2, limit: 20 }), {
    tenantId: 'tenant-a', branchId: 'branch-a', page: 2, limit: 20
  });
});

test('catalog query allows backend default branch resolution when branch is not hydrated yet', () => {
  assert.deepEqual(buildCatalogQuery({ tenantId: 'tenant-a' }), {
    tenantId: 'tenant-a', page: 1, limit: 16
  });
});

test('catalog query rejects missing pharmacy selection', () => {
  assert.throws(() => buildCatalogQuery({ tenantId: null }), error => error.code === 'PHARMACY_SELECTION_REQUIRED');
});

test('catalog response mapper handles direct, nested and array contracts', () => {
  const medicine = { _id: 'm1', name: 'Medicine' };
  assert.deepEqual(normalizeCatalogResponse({ data: { medicines: [medicine], total: 8, page: 2, totalPages: 4 } }), {
    medicines: [medicine], total: 8, page: 2, limit: 1, totalPages: 4, isSearching: false, outOfStockHidden: undefined
  });
  assert.deepEqual(normalizeCatalogResponse({ data: { data: { medicines: [medicine], total: 1 } } }).medicines, [medicine]);
  assert.deepEqual(normalizeCatalogResponse({ data: [medicine] }).medicines, [medicine]);
});

test('catalog response mapper rejects invalid payload with stable error code', () => {
  assert.throws(() => normalizeCatalogResponse({ data: { success: true } }), error => error.code === 'INVALID_CATALOG_RESPONSE');
});
