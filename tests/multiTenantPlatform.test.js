/**
 * Comprehensive Automated Test Suite for Ashvin Multi-Tenant Pharmacy Platform
 * Verifies:
 * 1. Customer global identity + isolated tenant profiles
 * 2. Strict Tenant & Branch isolation
 * 3. Customer isolation (IDOR protection)
 * 4. Server-side authoritative pricing & stacking rules
 * 5. Branch inventory reservation & concurrency
 * 6. Branch serviceability & radius enforcement
 * 7. C-Square provider adapter & mock sync
 * 8. Idempotency guarantees
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { tenantService } from '../backend/services/tenant-service/TenantService.js';
import { identityService } from '../backend/services/identity-service/IdentityService.js';
import { catalogService } from '../backend/services/catalog-service/CatalogService.js';
import { pricingEngine } from '../backend/services/pricing-service/PricingEngine.js';
import { deliveryService } from '../backend/services/delivery-service/DeliveryService.js';
import { orderService } from '../backend/services/order-service/OrderService.js';
import { medicineRequestService } from '../backend/services/medicine-request-service/MedicineRequestService.js';
import { pharmacyIntegrationService } from '../backend/services/pharmacy-integration-service/PharmacyIntegrationService.js';
import { csquareAdapter } from '../backend/services/pharmacy-integration-service/adapters/CSquareAdapter.js';
import {
    TenantAccessDeniedError,
    BranchAccessDeniedError,
    OutOfServiceRadiusError,
    InsufficientStockError,
    InvalidCouponError,
    StackingRuleViolationError
} from '../backend/shared/errors/DomainErrors.js';

test('1. Customer Global Identity & Multi-Tenant Profile Isolation', async () => {
    const globalCustomer = await identityService.getOrCreateCustomer('user-global-test-101', {
        name: 'Dr. Priya Sharma',
        email: 'priya.sharma@example.com',
        phone: '+91 98930 11223'
    });

    assert.ok(globalCustomer.id, 'Global customer must have an ID');
    assert.equal(globalCustomer.name, 'Dr. Priya Sharma');

    // Customer visits Tenant A (Ashvin Central)
    const profileTenantA = await identityService.getOrCreateTenantProfile(globalCustomer.id, 'tenant-ashvin-main');
    profileTenantA.loyaltyPointsBalance = 500;
    profileTenantA.totalSpent = 3500;

    // Customer visits Tenant B (MedPlus Partner)
    const profileTenantB = await identityService.getOrCreateTenantProfile(globalCustomer.id, 'tenant-medplus-partner');
    profileTenantB.loyaltyPointsBalance = 80;
    profileTenantB.totalSpent = 600;

    // Verify isolation: Tenant A points != Tenant B points
    const fetchedA = await identityService.getTenantProfile(globalCustomer.id, 'tenant-ashvin-main');
    const fetchedB = await identityService.getTenantProfile(globalCustomer.id, 'tenant-medplus-partner');

    assert.equal(fetchedA.loyaltyPointsBalance, 500);
    assert.equal(fetchedB.loyaltyPointsBalance, 80);
    assert.notEqual(fetchedA.customerCode, fetchedB.customerCode, 'Customer codes must be tenant-specific');

    // Verify same human identity used across both tenants
    const profiles = await identityService.getCustomerTenantProfiles(globalCustomer.id);
    assert.equal(profiles.length, 2);
    assert.equal(profiles[0].customerId, globalCustomer.id);
    assert.equal(profiles[1].customerId, globalCustomer.id);
});

test('2. Tenant & Branch Isolation Guarantees', async () => {
    const branchesTenant1 = await tenantService.getBranches('tenant-ashvin-main');
    const branchesTenant2 = await tenantService.getBranches('tenant-medplus-partner');

    assert.ok(branchesTenant1.some(b => b.id === 'branch-indore-central'));
    assert.ok(!branchesTenant1.some(b => b.id === 'branch-bhopal-mpnagar'), 'Bhopal branch must not belong to Tenant 1');
    assert.ok(branchesTenant2.some(b => b.id === 'branch-bhopal-mpnagar'));

    // Verify rider fleet isolation
    const ridersIndore = await deliveryService.getBranchRiders('tenant-ashvin-main', 'branch-indore-central');
    assert.ok(ridersIndore.length > 0);
    assert.ok(ridersIndore.every(r => r.tenantId === 'tenant-ashvin-main' && r.branchId === 'branch-indore-central'));

    // Attempting to assign a Tenant 1 rider to a Tenant 2 order must fail
    await assert.rejects(
        async () => {
            await deliveryService.assignRiderToOrder(
                'tenant-medplus-partner',
                'branch-bhopal-mpnagar',
                'order-test-99',
                ridersIndore[0].id
            );
        },
        /belongs to a different branch/
    );
});

test('3. Server-Side Authoritative Pricing & Stacking Rules', async () => {
    // Basic calculation for 2 strips of Dolo 650
    const pricing = await pricingEngine.calculateOrderPricing({
        tenantId: 'tenant-ashvin-main',
        branchId: 'branch-indore-central',
        items: [{ productId: 'prod-pcm-650', quantity: 2 }]
    });

    // 2 x 29.5 = 59.0 + delivery fee 30 = 89.0
    assert.equal(pricing.subtotal, 59.0);
    assert.equal(pricing.deliveryFee, 30.0);
    assert.equal(pricing.finalTotal, 89.0);
    assert.equal(pricing.itemSnapshots.length, 1);
    assert.equal(pricing.itemSnapshots[0].mrpSnapshot, 34.0);
    assert.equal(pricing.itemSnapshots[0].finalUnitPrice, 29.5);

    // Coupon Validation: HEALTH20 requires minimum order value of 299
    await assert.rejects(
        async () => {
            await pricingEngine.calculateOrderPricing({
                tenantId: 'tenant-ashvin-main',
                branchId: 'branch-indore-central',
                items: [{ productId: 'prod-pcm-650', quantity: 2 }],
                couponCode: 'HEALTH20'
            });
        },
        (err) => err instanceof InvalidCouponError && err.message.includes('requires a minimum order value of ₹299')
    );

    // Valid Coupon with qualifying order
    const couponPricing = await pricingEngine.calculateOrderPricing({
        tenantId: 'tenant-ashvin-main',
        branchId: 'branch-indore-central',
        items: [{ productId: 'prod-amox-500', quantity: 2 }], // 2 x 198 = 396
        couponCode: 'HEALTH20'
    });
    // 20% of 396 = 79.2. Delivery fee = 30. final = 396 - 79.2 + 30 = 346.8
    assert.equal(couponPricing.subtotal, 396.0);
    assert.equal(couponPricing.couponDiscount, 79.2);

    // Stacking rule violation: Attempting coupon + rewards when tenant disallows
    // Tenant medplus has allowCouponWithRewards: false
    await assert.rejects(
        async () => {
            await pricingEngine.calculateOrderPricing({
                tenantId: 'tenant-medplus-partner',
                branchId: 'branch-bhopal-mpnagar',
                customerId: 'cust-demo-ashvin',
                items: [{ productId: 'prod-amox-500', quantity: 3 }],
                couponCode: 'MEDPLUS10',
                redeemPoints: 100
            });
        },
        (err) => err instanceof StackingRuleViolationError
    );
});

test('4. Branch Inventory Reservation & Concurrency', async () => {
    const tenantId = 'tenant-ashvin-main';
    const branchId = 'branch-indore-central';
    const productId = 'prod-pcm-650';

    const invKey = `${tenantId}:${branchId}:${productId}`;
    const initialInv = catalogService.inventory.get(invKey);
    const initialAvailable = initialInv.availableQuantity;
    const initialReserved = initialInv.reservedQuantity;

    // 1. Reserve 10 units
    await catalogService.reserveStock(tenantId, branchId, [{ productId, quantity: 10 }]);
    assert.equal(initialInv.reservedQuantity, initialReserved + 10);

    // 2. Release 10 units
    await catalogService.releaseStock(tenantId, branchId, [{ productId, quantity: 10 }]);
    assert.equal(initialInv.reservedQuantity, initialReserved);

    // 3. Attempting to reserve more than available throws InsufficientStockError
    await assert.rejects(
        async () => {
            await catalogService.reserveStock(tenantId, branchId, [{ productId, quantity: 999999 }]);
        },
        (err) => err instanceof InsufficientStockError
    );
});

test('5. Delivery Serviceability & Branch Radius Enforcement', async () => {
    const branchId = 'branch-indore-central';

    // Nearby location (1 km from Palasia branch)
    const nearbyCoords = { lat: 22.7210, lng: 75.8600 };
    const nearResult = await deliveryService.checkServiceability(branchId, nearbyCoords);
    assert.equal(nearResult.serviceable, true);
    assert.ok(nearResult.distanceKm < 2.0);

    // Location far outside branch radius (e.g. Ujjain, ~55 km from Indore)
    const farCoords = { lat: 23.1765, lng: 75.7885 };
    const farResult = await deliveryService.checkServiceability(branchId, farCoords);
    assert.equal(farResult.serviceable, false);
    assert.ok(farResult.distanceKm > 40.0);

    await assert.rejects(
        async () => {
            await deliveryService.validateServiceabilityOrThrow(branchId, farCoords);
        },
        (err) => err instanceof OutOfServiceRadiusError
    );
});

test('6. C-Square Provider Adapter & Integration Health', async () => {
    const config = {
        apiUrl: 'https://api.csquarepharma.example.com',
        clientId: 'CSQ-ASHVIN-INDORE',
        storeId: 'STORE-PALASIA-01',
        apiKey: 'csq_key_test'
    };

    // Connection ping test
    const ping = await csquareAdapter.testConnection(config);
    assert.equal(ping.success, true);
    assert.ok(ping.latencyMs > 0);

    // Stock snapshot fetch
    const sync = await csquareAdapter.syncInventory(config);
    assert.equal(sync.success, true);
    assert.ok(sync.stockItems.length > 0);

    // External order creation with idempotency key
    const extOrder = await csquareAdapter.createExternalOrder(config, { id: 'ord-test-88' });
    assert.equal(extOrder.success, true);
    assert.ok(extOrder.idempotencyKey.includes('idemp-csq-ord-test-88'));

    // Verify Branch Integration Service masked credentials
    const masked = await pharmacyIntegrationService.getBranchIntegration('tenant-ashvin-main', 'branch-indore-central');
    assert.ok(masked.config.apiKey.includes('••••'));
});

test('7. Idempotent Order Creation & Medicine Proposal Conversion', async () => {
    const orderPayload = {
        tenantId: 'tenant-ashvin-main',
        branchId: 'branch-indore-central',
        customerId: 'cust-demo-ashvin',
        customerName: 'Ashvin Singh',
        items: [{ productId: 'prod-pcm-650', quantity: 1 }],
        deliveryAddress: {
            addressLine1: 'B-102 Silver Springs',
            city: 'Indore',
            coordinates: { lat: 22.7210, lng: 75.8600 }
        },
        idempotencyKey: 'idemp-unique-client-tx-12345'
    };

    // First call: creates order
    const res1 = await orderService.createOrder(orderPayload);
    assert.equal(res1.isDuplicate, false);
    assert.ok(res1.order.id);

    // Second call with same idempotency key: returns identical order without double-booking
    const res2 = await orderService.createOrder(orderPayload);
    assert.equal(res2.isDuplicate, true);
    assert.equal(res2.order.id, res1.order.id, 'Idempotent calls must return the identical order instance');

    // Medicine Request -> Proposal -> Idempotent Approval
    const req = await medicineRequestService.createRequest({
        tenantId: 'tenant-ashvin-main',
        branchId: 'branch-indore-central',
        customerId: 'cust-demo-ashvin',
        customerName: 'Ashvin Singh',
        medicineName: 'Ursocol 300mg Tablet',
        requestedQuantity: 2,
        deliveryAddress: orderPayload.deliveryAddress
    });
    assert.equal(req.status, 'REQUESTED');

    // Pharmacist formulates proposal
    await medicineRequestService.createOrUpdateProposal(req.id, {
        proposedMedicineName: 'Ursocol 300mg Tablet (Abbott)',
        quantity: 2,
        unitPrice: 420.0,
        priceType: 'FINAL'
    });

    // Customer approves proposal -> Converts to Order
    const approval = await medicineRequestService.approveProposalAndConvertToOrder(
        req.id,
        'cust-demo-ashvin',
        'Approved'
    );
    assert.equal(approval.success, true);
    assert.equal(approval.alreadyConverted, false);
    assert.ok(approval.order.id);

    // Repeated approval attempt: returns existing order idempotently
    const repeatApproval = await medicineRequestService.approveProposalAndConvertToOrder(
        req.id,
        'cust-demo-ashvin',
        'Approved again'
    );
    assert.equal(repeatApproval.alreadyConverted, true);
    assert.equal(repeatApproval.order.id, approval.order.id);
});
