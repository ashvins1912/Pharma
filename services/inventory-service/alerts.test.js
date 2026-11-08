import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventoryAlerts } from './alerts.js';

const now = new Date('2026-11-08T12:00:00.000Z');

test('builds expired, expiring-soon and low-stock alerts from branch inventory batches', () => {
  const result = buildInventoryAlerts([{
    _id: 'product-1',
    name: 'Medicine A',
    batchCount: 2,
    availableQuantity: 2,
    expiredBatchAvailability: [
      { batchNumber: 'OLD-1', expiryDate: '2026-11-07T00:00:00.000Z', stockQuantity: 5, availableQuantity: 4 },
      { batchNumber: 'EMPTY-OLD', expiryDate: '2026-11-01T00:00:00.000Z', stockQuantity: 0, availableQuantity: 0 }
    ],
    batchAvailability: [
      { batchNumber: 'SOON-1', expiryDate: '2026-11-08T00:00:00.000Z', stockQuantity: 2, availableQuantity: 1 },
      { batchNumber: 'SOON-2', expiryDate: '2026-12-08T00:00:00.000Z', stockQuantity: 3, availableQuantity: 3 },
      { batchNumber: 'LATER', expiryDate: '2026-12-09T00:00:00.000Z', stockQuantity: 3, availableQuantity: 3 }
    ]
  }], { now });

  assert.equal(result.expiredCount, 1);
  assert.equal(result.expired[0].batchNumber, 'OLD-1');
  assert.equal(result.expired[0].daysLeft, -1);
  assert.equal(result.expiringSoonCount, 2);
  assert.deepEqual(result.expiringSoon.map(item => item.daysLeft), [0, 30]);
  assert.equal(result.lowStockCount, 1);
  assert.equal(result.lowStock[0].stock, 2);
  assert.equal(result.totalAlerts, 4);
});

test('does not report expired stock without positive quantity or products with no branch batches', () => {
  const result = buildInventoryAlerts([
    {
      name: 'Empty medicine',
      batchCount: 1,
      availableQuantity: 0,
      expiredBatchAvailability: [{ expiryDate: '2026-11-01', stockQuantity: 0 }],
      batchAvailability: []
    },
    {
      name: 'No branch stock',
      batchCount: 0,
      availableQuantity: 0,
      expiredBatchAvailability: [],
      batchAvailability: []
    }
  ], { now });

  assert.deepEqual(result, {
    expiredCount: 0,
    expiringSoonCount: 0,
    lowStockCount: 1,
    totalAlerts: 1,
    expired: [],
    expiringSoon: [],
    lowStock: [{ name: 'Empty medicine', batchCount: 1, availableQuantity: 0, expiredBatchAvailability: [{ expiryDate: '2026-11-01', stockQuantity: 0 }], batchAvailability: [], stock: 0 }]
  });
});

test('limits displayed alert rows to 20 while preserving exact counts', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({
    _id: String(index),
    batchCount: 1,
    availableQuantity: 1,
    batchAvailability: [{ batchNumber: `B-${index}`, expiryDate: '2026-11-09', stockQuantity: 1 }]
  }));
  const result = buildInventoryAlerts(items, { now });
  assert.equal(result.expiringSoonCount, 25);
  assert.equal(result.expiringSoon.length, 20);
  assert.equal(result.totalAlerts, 25);
});

test('rejects an invalid reference date rather than silently misclassifying expiry', () => {
  assert.throws(() => buildInventoryAlerts([], { now: 'not-a-date' }), /valid current date/i);
});
