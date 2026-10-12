import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyDeliverySignature } from './DeliveryEventService.js';

test('delivery signature verifies timestamped raw request bytes and rejects stale signatures', () => {
    const previousSecret = process.env.DELIVERY_EVENT_SECRET;
    const secret = 'delivery-test-secret-that-is-at-least-32-characters';
    process.env.DELIVERY_EVENT_SECRET = secret;
    const rawBody = Buffer.from('{"eventId":"event-1234","action":"cash_received"}');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
    try {
        assert.equal(verifyDeliverySignature(rawBody, signature, timestamp), true);
        assert.equal(verifyDeliverySignature(rawBody, `0${signature.slice(1)}`, timestamp), false);
        assert.equal(verifyDeliverySignature(rawBody, signature, String(Number(timestamp) - 301)), false);
        assert.equal(verifyDeliverySignature(rawBody, 'bad', timestamp), false);
        assert.equal(verifyDeliverySignature(undefined, signature, timestamp), false);
    } finally {
        if (previousSecret === undefined) delete process.env.DELIVERY_EVENT_SECRET;
        else process.env.DELIVERY_EVENT_SECRET = previousSecret;
    }
});
