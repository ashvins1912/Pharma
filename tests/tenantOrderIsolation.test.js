import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryOrderRepository } from '../backend/modules/delivery/infrastructure/repositories/InMemoryOrderRepository.js';
import { isSameTenant, tenantScopedFilter } from '../backend/authorization/tenantScope.js';

test('tenant order repository only lists, reads and updates orders in its tenant', async () => {
    const orders = [
        { _id: 'order-a', tenantId: 'tenant-a', userId: 'customer-a', orderStatus: 'Ready to Dispatch', items: [] },
        { _id: 'order-b', tenantId: 'tenant-b', userId: 'customer-b', orderStatus: 'Ready to Dispatch', items: [] }
    ];
    const store = {
        getOrderById: async id => orders.find(order => String(order._id) === String(id)) || null,
        getAllOrders: async () => orders
    };
    const repository = new InMemoryOrderRepository(store);

    assert.equal((await repository.findAll({ tenantId: 'tenant-a' })).length, 1);
    assert.equal((await repository.findAll({ tenantId: 'tenant-a' }))[0].tenantId, 'tenant-a');
    assert.equal(await repository.findById('order-b', 'tenant-a'), null);
    assert.equal((await repository.findById('order-b', 'tenant-b')).tenantId, 'tenant-b');
    assert.equal(await repository.update('order-b', { orderStatus: 'Dispatched' }, 'tenant-a'), null);
    assert.equal(orders[1].orderStatus, 'Ready to Dispatch');
    const updated = await repository.update('order-a', { orderStatus: 'Dispatched', tenantId: 'tenant-b' }, 'tenant-a');
    assert.equal(updated.orderStatus, 'Dispatched');
    assert.equal(updated.tenantId, 'tenant-a');
    assert.equal(orders[0].tenantId, 'tenant-a');
});

test('tenant-scoped proximity queries exclude orders from other tenants', async () => {
    const orders = [
        { _id: 'order-a', tenantId: 'tenant-a', orderStatus: 'Ready to Dispatch', rider: { riderId: 'rider-a' }, coordinates: { lng: 77.5946, lat: 12.9716 } },
        { _id: 'order-b', tenantId: 'tenant-b', orderStatus: 'Ready to Dispatch', rider: { riderId: 'rider-b' }, coordinates: { lng: 77.5946, lat: 12.9716 } }
    ];
    const repository = new InMemoryOrderRepository({ getAllOrders: async () => orders });
    const result = await repository.findActiveOrdersInProximity([77.5946, 12.9716], 2000, ['Ready to Dispatch'], 'tenant-a');
    assert.deepEqual(result.map(item => item.order.id), ['order-a']);
    assert.deepEqual(await repository.findActiveOrdersInProximity([77.5946, 12.9716], 2000, ['Ready to Dispatch']), []);
});

test('tenant ownership filters are fail-closed and cannot be built without a tenant', () => {
    assert.equal(isSameTenant('tenant-a', 'tenant-b'), false);
    assert.equal(isSameTenant('tenant-a', 'tenant-a'), true);
    assert.equal(tenantScopedFilter('', { orderStatus: 'Ready to Dispatch' }), null);
    assert.deepEqual(tenantScopedFilter('tenant-b', { orderStatus: 'Ready to Dispatch' }), {
        orderStatus: 'Ready to Dispatch', tenantId: 'tenant-b'
    });
});
