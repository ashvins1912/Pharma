import assert from 'node:assert/strict';
import test from 'node:test';
import { authService } from '../backend/services/identity-service/AuthService.js';
import { notificationService } from '../backend/services/notification-service/NotificationService.js';
import { deliveryService } from '../backend/services/delivery-service/DeliveryService.js';

test('1. AuthService: isolated authentication, password hashing, and credentials verification', async () => {
    // Test registration
    const uniqueEmail = `test-user-${Date.now()}@example.com`;
    const signupResult = await authService.registerUser({
        firstName: 'Dev',
        lastName: 'Tester',
        email: uniqueEmail,
        mobile: '9876543210',
        dateOfBirth: '1992-04-10',
        gender: 'PREFER_NOT_TO_SAY',
        password: 'Password@123'
    });

    assert.ok(signupResult.user.id);
    assert.equal(signupResult.user.email, uniqueEmail.toLowerCase());
    assert.equal(signupResult.user.emailVerified, false);
    assert.equal(signupResult.user.status, 'PENDING_VERIFICATION');

    // Attempting login before email verification should fail
    await assert.rejects(
        authService.authenticateCredentials({ email: uniqueEmail, password: 'Password@123' }),
        err => err.code === 'EMAIL_NOT_VERIFIED'
    );

    // Fetch user and verify token
    const savedUser = await authService.findUser({ normalizedEmail: uniqueEmail.toLowerCase() });
    assert.ok(savedUser);
    assert.ok(savedUser.verificationTokenHash);

    // Verify user manually in service
    savedUser.emailVerified = true;
    savedUser.status = 'ACTIVE';
    await authService.saveUser(savedUser.userId || savedUser.id, savedUser);

    // Now login should succeed
    const loginResult = await authService.authenticateCredentials({ email: uniqueEmail, password: 'Password@123' });
    assert.ok(loginResult.accessToken);
    assert.equal(loginResult.user.email, uniqueEmail.toLowerCase());
    assert.equal(loginResult.user.scope, 'CUSTOMER');
});

test('2. Delivery Status Push: real-time multi-branch event broadcast to Tenant Admin', async () => {
    const receivedEvents = [];

    // Simulate connected Tenant Admin SSE client
    const fakeRes = {
        write: (chunk) => {
            if (chunk.startsWith('data: ')) {
                const parsed = JSON.parse(chunk.slice(6));
                receivedEvents.push(parsed);
            }
        }
    };

    const clientId = 'test-tenant-admin-sse';
    notificationService.addSseClient(clientId, fakeRes, {
        tenantId: 'tenant-ashvin-main',
        branchId: 'branch-indore-central',
        userId: 'admin-01',
        isSuperAdmin: false
    });

    try {
        // Trigger delivery state transition across branch
        const testOrderId = `order-test-${Date.now()}`;
        await deliveryService.assignRiderToOrder(
            'tenant-ashvin-main',
            'branch-indore-central',
            testOrderId,
            'rider-ind-01',
            { userId: 'admin-indore' }
        );

        // Update job status to OUT_FOR_DELIVERY
        await deliveryService.updateJobStatus(testOrderId, 'OUT_FOR_DELIVERY', {
            userId: 'admin-indore',
            tenantId: 'tenant-ashvin-main'
        });

        // Verify that delivery events were pushed to the client
        assert.ok(receivedEvents.length >= 2, 'Should have received RIDER_ASSIGNED and DELIVERY_STATUS_CHANGED');
        const statusEvent = receivedEvents.find(e => e.status === 'OUT_FOR_DELIVERY');
        assert.ok(statusEvent, 'OUT_FOR_DELIVERY event must be delivered via push');
        assert.equal(statusEvent.tenantId, 'tenant-ashvin-main');
        assert.equal(statusEvent.branchId, 'branch-indore-central');
        assert.equal(statusEvent.orderId, testOrderId);
        assert.equal(statusEvent.riderName, 'Rahul Verma');

        // Check history buffer
        const history = notificationService.getDeliveryEvents('tenant-ashvin-main', 'branch-indore-central');
        assert.ok(history.some(h => h.orderId === testOrderId));
    } finally {
        notificationService.removeSseClient(clientId);
    }
});
