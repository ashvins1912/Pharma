import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderStatusFilter, orderHasStatus } from './orderStatusFilters.js';

test('legacy lifecycle status matches even when the other status field is populated', () => {
  const delivered = new Set(['delivered', 'completed', 'delivered_order']);
  const cancelled = new Set(['cancelled', 'cancelled_order']);
  assert.equal(orderHasStatus({ orderStatus: 'Pending_Review', status: 'Delivered' }, delivered), true);
  assert.equal(orderHasStatus({ orderStatus: 'Processing Order', status: 'CANCELLED' }, cancelled), true);
  assert.equal(orderHasStatus({ orderStatus: 'Delivered', status: 'Pending_Review' }, delivered), true);
  assert.equal(orderHasStatus({ orderStatus: 'Dispatched', status: 'accepted' }, delivered), false);
});

test('Mongo status filter independently checks both lifecycle fields', () => {
  const filter = buildOrderStatusFilter(['Delivered', 'delivered']);
  assert.deepEqual(filter, {
    $or: [
      { orderStatus: { $in: ['Delivered', 'delivered'] } },
      { status: { $in: ['Delivered', 'delivered'] } }
    ]
  });
});
