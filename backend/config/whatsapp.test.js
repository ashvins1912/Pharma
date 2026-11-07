import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MONGO_URI = 'mongodb://localhost:27017/pharma';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-with-sufficient-length';
process.env.NODE_ENV = 'test';

const { buildWhatsAppMessageBody, buildWhatsAppMedicineRequestBody } = await import('./whatsapp.js');

const order = {
    id: 'order-123456',
    customerName: 'Customer Name',
    customerMobile: '+919876543210',
    deliveryAddress: 'House 10, Main Road, Bengaluru, Karnataka - 560001',
    addressDetails: {
        fullName: 'Customer Name',
        mobile: '+919876543210',
        addressLine1: 'House 10, Main Road',
        addressLine2: 'Indiranagar',
        landmark: 'Near Park',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001'
    },
    coordinates: { lat: 12.9, lng: 77.6 },
    rider: { riderName: 'Assigned Rider', riderMobile: '+919900001111' },
    items: [{ name: 'Medicine A', quantity: 2 }],
    finalTotal: 450,
    paymentMethod: 'Cash on Delivery (COD)'
};

test('rider assignment alert contains order, customer contact, full address, and item details', () => {
    const message = buildWhatsAppMessageBody(order, 'Assigned', 'rider');
    for (const detail of [
        'Order #123456',
        'Customer: Customer Name',
        'Customer contact: +919876543210',
        'House 10, Main Road',
        'Indiranagar',
        'Near Park',
        'Bengaluru, Karnataka, 560001',
        'Medicine A x2'
    ]) {
        assert.ok(message.includes(detail), `Expected rider message to include: ${detail}`);
    }
});

test('rider assignment alert contains usable action buttons/links (Accept, View Delivery, Navigate)', () => {
    const message = buildWhatsAppMessageBody(order, 'Assigned', 'rider');
    assert.match(message, /Accept Delivery:/, 'Should contain Accept Delivery action');
    assert.match(message, /View Delivery:/, 'Should contain View Delivery action');
    assert.match(message, /Navigate:/, 'Should contain Navigate action');
});

test('rider dispatched alert contains cash collection actions for COD order', () => {
    const message = buildWhatsAppMessageBody(order, 'Dispatched', 'rider');
    assert.match(message, /Cash received:/, 'Should contain Cash received action');
    assert.match(message, /Cash not received:/, 'Should contain Cash not received action');
});

test('customer assignment alert includes assigned rider details and delivery address', () => {
    const message = buildWhatsAppMessageBody(order, 'Assigned', 'customer');
    assert.match(message, /DELIVERY RIDER ASSIGNED — #123456/);
    assert.match(message, /Rider: Assigned Rider/);
    assert.match(message, /Rider contact: \+919900001111/);
    assert.match(message, /Complete delivery address:.*560001/);
});

test('new-order admin alert includes customer contact, delivery address, and items', () => {
    const message = buildWhatsAppMessageBody(order, 'Placed', 'admin');
    assert.match(message, /NEW ORDER RECEIVED — #123456/);
    assert.match(message, /Customer contact: \+919876543210/);
    assert.match(message, /Complete delivery address:.*560001/);
    assert.match(message, /Medicine A x2/);
});

test('customer WhatsApp order updates use the saved Hindi locale and preserve OTP handover safety', () => {
    const message = buildWhatsAppMessageBody(order, 'Dispatched', 'customer', {
        deliveryOtp: '4821',
        language: 'hi'
    });
    assert.match(message, /आपका ऑर्डर डिलीवरी के लिए निकल गया/);
    assert.match(message, /4 अंकों का सत्यापन कोड: 4821/);
    assert.match(message, /राइडर आने से पहले साझा न करें/);
    assert.match(message, /House 10, Main Road/);
});

test('customer WhatsApp medicine-request proposal uses the saved Kannada locale', () => {
    const message = buildWhatsAppMedicineRequestBody({
        requestNumber: 'MR-2026-10',
        requestedItems: [{ requestedName: 'Medicine A', quantity: 2 }],
        pharmacyProposal: { proposedMedicineName: 'Medicine A', proposedQuantity: 2, finalPrice: 250 }
    }, 'MedicineProposalReady', 'kn');
    assert.match(message, /ನಿಮ್ಮ ಔಷಧಿ ವಿನಂತಿಗೆ ಔಷಧಾಲಯದ ಪ್ರಸ್ತಾವನೆ ಸಿದ್ಧವಾಗಿದೆ/);
    assert.match(message, /ಬೆಲೆ: ₹250/);
    assert.match(message, /Medicine A/);
});
