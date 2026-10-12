import test from 'node:test';
import assert from 'node:assert/strict';
import { startSharedEventConsumer } from './sharedEvents.js';

test('routes user and tenant events to target rooms, not global sockets', async () => {
  const calls = [];
  const io = {
    emit: (...args) => calls.push(['global', ...args]),
    to: rooms => ({ emit: (...args) => calls.push([rooms, ...args]) })
  };
  let pollCount = 0;
  const client = {
    enabled: true,
    async getEventCursor() { return '0-0'; },
    async acknowledgeEvents() {},
    async pollEvents() {
      pollCount += 1;
      if (pollCount === 1) return { cursor: '1-0', events: [
        { channel: 'notification', userId: 'user-1', payload: { safe: true } },
        { channel: 'tenant_update', tenantId: 'tenant-1', payload: { count: 1 } },
        { channel: 'order_status_changed', userId: 'user-1', tenantId: 'tenant-1', riderId: 'rider-1', payload: { orderId: 'order-1', status: 'Dispatched' } },
        { channel: 'catalog_updated', payload: { public: true } },
        { channel: 'notification', payload: { unsafe: true } }
      ] };
      return new Promise(resolve => setTimeout(() => resolve({ cursor: '1-0', events: [] }), 10));
    }
  };
  const stop = startSharedEventConsumer(io, { cacheClient: client, logger: { warn() {}, error() {} } });
  await new Promise(resolve => setTimeout(resolve, 20));
  await stop();
  assert.deepEqual(calls, [
    [['bell_notifications_user-1'], 'notification', { safe: true }],
    [['tenant_tenant-1'], 'tenant_update', { count: 1 }],
    [['bell_notifications_user-1', 'tenant_tenant-1', 'rider_rider-1', 'order_tracking_order-1'], 'order_status_changed', { orderId: 'order-1', status: 'Dispatched' }]
  ]);
});
