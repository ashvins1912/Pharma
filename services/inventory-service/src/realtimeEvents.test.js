import assert from 'node:assert/strict';
import test from 'node:test';
import { publishInventoryChanged } from './realtimeEvents.js';

test('publishes a tenant-scoped inventory invalidation with branch metadata', async () => {
  const calls = [];
  const cacheClient = {
    enabled: true,
    async publishEvent(...args) { calls.push(args); }
  };
  const published = await publishInventoryChanged({
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    reason: 'inventory.adjusted',
    entityId: 'sku-1'
  }, cacheClient);

  assert.equal(published, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'inventory_changed');
  assert.equal(calls[0][1].tenantId, 'tenant-a');
  assert.equal(calls[0][1].branchId, 'branch-a');
  assert.equal(calls[0][1].reason, 'inventory.adjusted');
  assert.deepEqual(calls[0][2], { tenantId: 'tenant-a' });
  assert.ok(calls[0][1].eventId);
});

test('does not publish events without a verified tenant and branch', async () => {
  let calls = 0;
  const cacheClient = { enabled: true, async publishEvent() { calls += 1; } };
  assert.equal(await publishInventoryChanged({ tenantId: 'tenant-a' }, cacheClient), false);
  assert.equal(calls, 0);
});

test('does not fail a completed write when the shared event transport is disabled', async () => {
  const cacheClient = { enabled: false, async publishEvent() { throw new Error('must not be called'); } };
  assert.equal(await publishInventoryChanged({ tenantId: 'tenant-a', branchId: 'branch-a' }, cacheClient), false);
});

test('does not throw when the shared event transport is unavailable', async () => {
  const cacheClient = { enabled: true, async publishEvent() { throw new Error('cache offline'); } };
  assert.equal(await publishInventoryChanged({ tenantId: 'tenant-a', branchId: 'branch-a' }, cacheClient), false);
});
