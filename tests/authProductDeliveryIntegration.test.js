import assert from 'node:assert/strict';
import test from 'node:test';
import { authService } from '../backend/services/identity-service/AuthService.js';
import { productService } from '../backend/services/catalog-service/ProductService.js';
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

test('2. ProductService: dual-source mapping and master + mongo harmonization', async () => {
    // Source 1: Master catalog definition
    const masterDrug = {
        id: 'master-para-650',
        name: 'Paracetamol 650 IP',
        genericName: 'Paracetamol',
        composition: 'Paracetamol IP 650mg',
        manufacturer: 'Pharma India Labs',
        dosageForm: 'Tablet',
        category: 'Analgesics',
        mrp: 35.0,
        sellingPrice: 30.0,
        requiresPrescription: false
    };

    // Source 2: MongoDB branch operational item
    const mongoBranchItem = {
        _id: 'mongo-item-101',
        sku: 'PCM-650-IND',
        price: 28.5,
        basePrice: 35.0,
        discountPercentage: 18,
        stockQuantity: 150,
        reservedQuantity: 12,
        batchNumber: 'B-IND-2026',
        expiryDate: '2027-12-31T00:00:00Z',
        tenantId: 'tenant-ashvin-main',
        branchId: 'branch-indore-central'
    };

    // Harmonize both sources
    const harmonized = productService.mapAndHarmonize(masterDrug, mongoBranchItem, 'tenant-ashvin-main', 'branch-indore-central');

    assert.equal(harmonized.source, 'HYBRID');
    assert.equal(harmonized.name, 'Paracetamol 650 IP');
    assert.equal(harmonized.genericName, 'Paracetamol');
    assert.equal(harmonized.sku, 'PCM-650-IND');
    assert.equal(harmonized.price, 28.5, 'Branch price from Mongo should take precedence');
    assert.equal(harmonized.mrp, 35.0);
    assert.equal(harmonized.stockQuantity, 150);
    assert.equal(harmonized.availableQuantity, 138, '150 physical - 12 reserved = 138 available');
    assert.equal(harmonized.stockStatus, 'IN_STOCK');
    assert.equal(harmonized.branchId, 'branch-indore-central');
});

test('3. Delivery Status Push: real-time multi-branch event broadcast to Tenant Admin', async () => {
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
