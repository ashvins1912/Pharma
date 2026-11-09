import assert from 'node:assert/strict';
import test from 'node:test';
import { getInventoryAlertSummary } from './src/inventory.js';
import { Inventory } from './src/models.js';

test('inventory alert aggregation never nests $facet and preserves low-stock totals', async () => {
  const originalAggregate = Inventory.aggregate;
  let capturedPipeline;
  Inventory.aggregate = pipeline => {
    capturedPipeline = pipeline;
    return {
      allowDiskUse() { return this; },
      async exec() {
        return [{
          expired: [{ totalCount: 3, expiryDate: new Date('2026-01-01T00:00:00.000Z'), batchNumber: 'EXPIRED' }],
          expiringSoon: [{ totalCount: 4, expiryDate: new Date(Date.now() + 86400000), batchNumber: 'SOON' }],
          lowStock: [{ totalCount: 42, productId: 'product-1', name: 'Low stock medicine', availableQuantity: 1 }]
        }];
      }
    };
  };

  try {
    const result = await getInventoryAlertSummary({ tenantId: 'tenant-test', branchId: 'branch-test' });
    const facetCount = (value) => {
      if (Array.isArray(value)) return value.reduce((sum, entry) => sum + facetCount(entry), 0);
      if (!value || typeof value !== 'object') return 0;
      return Object.entries(value).reduce((sum, [key, entry]) => sum + (key === '$facet' ? 1 : 0) + facetCount(entry), 0);
    };

    assert.equal(facetCount(capturedPipeline), 1, 'only the outer alert-summary $facet should exist');
    const outerFacet = capturedPipeline.find(stage => stage.$facet)?.$facet;
    assert.ok(outerFacet?.lowStock, 'low-stock branch should be present');
    assert.ok(outerFacet.lowStock.some(stage => stage.$setWindowFields?.output?.totalCount?.$count), 'low-stock branch should count rows without a nested facet');
    assert.ok(outerFacet.lowStock.some(stage => stage.$limit === 20), 'low-stock payload should remain capped at 20 rows');

    assert.equal(result.expiredCount, 3);
    assert.equal(result.expiringSoonCount, 4);
    assert.equal(result.lowStockCount, 42);
    assert.equal(result.lowStock.length, 1);
    assert.equal(result.totalAlerts, 49);
  } finally {
    Inventory.aggregate = originalAggregate;
  }
});
