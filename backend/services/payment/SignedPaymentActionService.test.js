import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createPaymentSnoozeToken,
    verifyPaymentSnoozeToken,
    createRiderDeliveryActionToken,
    verifyRiderDeliveryActionToken
} from './SignedPaymentActionService.js';

test('signed payment action token binds customer, action, and expiry', () => {
    const previousSecret = process.env.SYSTEM_SECRET_KEY;
    process.env.SYSTEM_SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters';
    try {
        const token = createPaymentSnoozeToken('customer-123', { now: 1_700_000_000_000, ttlSeconds: 60 });
        assert.equal(verifyPaymentSnoozeToken(token, { now: 1_700_000_030_000 })?.customerId, 'customer-123');
        assert.equal(verifyPaymentSnoozeToken(token, { now: 1_700_000_060_000 }), null);
        assert.equal(verifyPaymentSnoozeToken(`${token}x`, { now: 1_700_000_030_000 }), null);
        assert.equal(verifyPaymentSnoozeToken('malformed', { now: 1_700_000_030_000 }), null);
    } finally {
        if (previousSecret === undefined) delete process.env.SYSTEM_SECRET_KEY;
        else process.env.SYSTEM_SECRET_KEY = previousSecret;
    }
});

test('rider action token binds the order, rider, action, and expiry', () => {
    const previousSecret = process.env.SYSTEM_SECRET_KEY;
    process.env.SYSTEM_SECRET_KEY = 'test-secret-key-that-is-at-least-32-characters';
    try {
        const token = createRiderDeliveryActionToken({ orderId: '65f000000000000000000001', riderId: 'rider-1', action: 'cash_received' }, {
            now: 1_700_000_000_000,
            ttlSeconds: 60
        });
        const claims = verifyRiderDeliveryActionToken(token, { now: 1_700_000_030_000 });
        assert.equal(claims.orderId, '65f000000000000000000001');
        assert.equal(claims.riderId, 'rider-1');
        assert.equal(claims.action, 'cash_received');
        assert.ok(claims.eventId);
        assert.equal(verifyRiderDeliveryActionToken(token, { now: 1_700_000_060_000 }), null);
    } finally {
        if (previousSecret === undefined) delete process.env.SYSTEM_SECRET_KEY;
        else process.env.SYSTEM_SECRET_KEY = previousSecret;
    }
});

test('signed payment actions fail closed when secret is missing', () => {
    const previousSecret = process.env.SYSTEM_SECRET_KEY;
    delete process.env.SYSTEM_SECRET_KEY;
    try {
        assert.throws(() => createPaymentSnoozeToken('customer-123'), { code: 'SIGNED_ACTIONS_NOT_CONFIGURED' });
        assert.equal(verifyPaymentSnoozeToken('malformed'), null);
    } finally {
        if (previousSecret !== undefined) process.env.SYSTEM_SECRET_KEY = previousSecret;
    }
});
