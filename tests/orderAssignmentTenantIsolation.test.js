import assert from 'node:assert/strict';
import test from 'node:test';
import { OrderAssignmentEngine } from '../backend/modules/delivery/services/OrderAssignmentEngine.js';

test('assignment engine refuses an already-assigned rider from a different tenant and sanitizes the response', async () => {
    const order = {
        id: 'order-a',
        tenantId: 'tenant-a',
        rider: { riderId: 'rider-b', riderName: 'Foreign Rider', riderMobile: '9999999999' },
        toJSON() {
            return { id: this.id, tenantId: this.tenantId, rider: this.rider, assignedRiderId: 'rider-b' };
        }
    };
    const engine = new OrderAssignmentEngine({
        orderRepository: { findById: async (id, tenantId) => id === 'order-a' && tenantId === 'tenant-a' ? order : null },
        riderRepository: { findById: async (id, tenantId) => id === 'rider-b' && tenantId === 'tenant-b' ? { id, tenantId } : null }
    });

    const result = await engine.assignOrder('order-a', { tenantId: 'tenant-a' });
    assert.equal(result.success, false);
    assert.equal(result.strategyUsed, 'INVALID_TENANT_RIDER');
    assert.equal(result.order.rider, null);
    assert.equal(result.order.assignedRiderId, null);
    assert.equal(result.rider, null);
});

test('assignment engine rejects a caller tenant that does not match the order tenant', async () => {
    const order = { id: 'order-a', tenantId: 'tenant-a', rider: null };
    const engine = new OrderAssignmentEngine({
        orderRepository: { findById: async () => order },
        riderRepository: { findById: async () => null }
    });
    await assert.rejects(
        engine.assignOrder('order-a', { tenantId: 'tenant-b' }),
        /Order tenant ownership is required/
    );
});
