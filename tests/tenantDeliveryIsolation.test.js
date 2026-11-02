import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationService } from '../backend/services/notification-service/NotificationService.js';

test('tenant delivery history is isolated and platform access is explicit', () => {
    const eventId = `tenant-isolation-${Date.now()}-${Math.random()}`;
    const event = {
        eventId,
        type: 'DELIVERY_STATUS_CHANGED',
        tenantId: 'tenant-a',
        branchId: 'branch-a',
        orderId: 'order-a',
        timestamp: new Date().toISOString()
    };

    notificationService._broadcastDeliveryEvent(event);

    assert.ok(notificationService.getDeliveryEvents('tenant-a').some(item => item.eventId === eventId));
    assert.ok(!notificationService.getDeliveryEvents('tenant-b').some(item => item.eventId === eventId));
    assert.ok(!notificationService.getDeliveryEvents(null, null).some(item => item.eventId === eventId));
    assert.ok(notificationService.getDeliveryEvents(null, null, true).some(item => item.eventId === eventId));
    assert.ok(!notificationService.getDeliveryEvents('tenant-a', 'branch-b').some(item => item.eventId === eventId));
});

test('SSE delivery events are sent only to the matching tenant and authorized branch', () => {
    const eventId = `tenant-sse-isolation-${Date.now()}-${Math.random()}`;
    const received = { tenantA: [], tenantB: [], tenantless: [], branchB: [], platform: [] };
    const makeResponse = list => ({ write: chunk => list.push(chunk) });
    const clients = [
        ['tenant-a-client', received.tenantA, { tenantId: 'tenant-a', branchId: null, isSuperAdmin: false }],
        ['tenant-b-client', received.tenantB, { tenantId: 'tenant-b', branchId: null, isSuperAdmin: false }],
        ['tenantless-client', received.tenantless, { tenantId: null, branchId: null, isSuperAdmin: false }],
        ['branch-b-client', received.branchB, { tenantId: 'tenant-a', branchId: 'branch-b', isSuperAdmin: false }],
        ['platform-client', received.platform, { tenantId: null, branchId: null, isSuperAdmin: true }]
    ];

    for (const [id, list, context] of clients) {
        notificationService.addSseClient(id, makeResponse(list), context);
    }

    try {
        notificationService._broadcastDeliveryEvent({
            eventId,
            type: 'DELIVERY_STATUS_CHANGED',
            tenantId: 'tenant-a',
            branchId: 'branch-a',
            orderId: 'order-a',
            timestamp: new Date().toISOString()
        });

        assert.equal(received.tenantA.length, 1);
        assert.equal(received.tenantB.length, 0);
        assert.equal(received.tenantless.length, 0);
        assert.equal(received.branchB.length, 0);
        assert.equal(received.platform.length, 1);
    } finally {
        for (const [id] of clients) notificationService.removeSseClient(id);
    }
});
