import assert from 'node:assert/strict';
import test from 'node:test';
import Order from './models/Order.js';
import { serializeOrder } from './routes/versionedOrderRoutes.js';
import { getWhatsAppStatusForOrderEvent, toOrderEventType } from './services/OrderEventService.js';

test('versioned order API serializes a stable public order and historical item snapshot', () => {
    const createdAt = new Date('2026-10-01T12:30:00.000Z');
    const response = serializeOrder({
        _id: 'internal-mongo-id',
        orderNumber: 'ORD-TEST-123',
        source: 'POS',
        externalReference: 'POS-10001',
        orderStatus: 'Processing Order',
        items: [{
            productId: 'internal-product-id',
            medicineId: 'internal-medicine-id',
            sku: 'MED123',
            productName: 'Paracetamol',
            genericName: 'Paracetamol',
            strength: '500mg',
            form: 'Tablet',
            manufacturer: 'Example Pharma',
            quantity: 2,
            unitPrice: 45,
            tax: 5,
            discount: 0,
            totalPrice: 90,
            snapshotAt: createdAt
        }],
        totalAmount: 90,
        finalTotal: 90,
        deliveryAddress: 'Example address',
        statusHistory: [],
        createdAt
    });

    assert.equal(response.orderId, 'ORD-TEST-123');
    assert.equal(response.externalReference, 'POS-10001');
    assert.equal(response.status, 'Processing Order');
    assert.equal(response.items[0].productId, 'MED123');
    assert.equal(response.items[0].manufacturer, 'Example Pharma');
    assert.equal(response.items[0].totalPrice, 90);
    assert.equal(Object.hasOwn(response, '_id'), false);
    assert.equal(Object.hasOwn(response.items[0], 'medicineId'), false);
});

test('order sources and events expose the normalized integration vocabulary', () => {
    const orderNumber = new Order().orderNumber;
    assert.match(orderNumber, /^ORD-[0-9a-f-]{36}$/i);
    const sourcePath = Order.schema.path('source');
    assert.deepEqual(sourcePath.enumValues, [
        'WEB', 'MOBILE', 'ADMIN', 'POS', 'ERP', 'PARTNER', 'API', 'MEDICINE_REQUEST', 'DIRECT'
    ]);
    assert.equal(toOrderEventType('Ready to Dispatch'), 'OrderReadyForDispatch');
    assert.equal(toOrderEventType('Delivered'), 'OrderDelivered');
    assert.equal(getWhatsAppStatusForOrderEvent('OrderAssigned'), 'Assigned');
    assert.equal(getWhatsAppStatusForOrderEvent('OrderInventoryReserved'), null);
});
