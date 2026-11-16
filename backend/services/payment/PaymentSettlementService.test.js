import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import mongoose from 'mongoose';
import test from 'node:test';
import { buildCaptureJournal, hashWebhookPayload, settleVerifiedPaymentCapture } from './PaymentSettlementService.js';
import { verifyPaymentWebhookSignature } from './PaymentWebhookSecurity.js';
import Order from '../../models/Order.js';
import PaymentWebhookEvent from '../../models/PaymentWebhookEvent.js';
import PaymentJournal from '../../models/PaymentJournal.js';
import PaymentOutbox from '../../models/PaymentOutbox.js';

test('capture journal balances debit and credit in integer minor units', () => {
  const journal = buildCaptureJournal({
    provider: 'testpay', eventId: 'evt-123456', orderNumber: 'ORD-1',
    tenantId: 'tenant-1', amountMinor: 10001, platformFeeBps: 250
  });
  const debits = journal.entries.filter(item => item.side === 'DEBIT').reduce((sum, item) => sum + item.amountMinor, 0);
  const credits = journal.entries.filter(item => item.side === 'CREDIT').reduce((sum, item) => sum + item.amountMinor, 0);
  assert.equal(debits, 10001);
  assert.equal(credits, 10001);
  assert.equal(journal.platformFeeMinor, 250);
  assert.equal(journal.sellerNetMinor, 9751);
  assert.equal(journal.idempotencyKey, 'payment-capture:testpay:evt-123456');
});

test('payment webhook HMAC rejects altered, stale and malformed requests', () => {
  const secret = 's'.repeat(40);
  const rawBody = Buffer.from('{"id":"evt-123456"}');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  assert.equal(verifyPaymentWebhookSignature(rawBody, signature, String(timestamp), secret), true);
  assert.equal(verifyPaymentWebhookSignature(Buffer.from('altered'), signature, String(timestamp), secret), false);
  assert.equal(verifyPaymentWebhookSignature(rawBody, signature, String(timestamp - 1000), secret), false);
  assert.equal(verifyPaymentWebhookSignature(rawBody, 'bad', String(timestamp), secret), false);
});

test('verified payment capture posts one journal and one outbox event despite webhook retries', {
  skip: !(process.env.PAYMENT_TEST_MONGO_URI || process.env.INVENTORY_TEST_MONGO_URI),
  timeout: 60000
}, async () => {
  const uri = process.env.PAYMENT_TEST_MONGO_URI || process.env.INVENTORY_TEST_MONGO_URI;
  const databaseName = `payment_settlement_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const tenantId = `tenant-${databaseName}`;
  await mongoose.connect(uri, { dbName: databaseName, serverSelectionTimeoutMS: 10000 });
  await Promise.all([Order.init(), PaymentWebhookEvent.init(), PaymentJournal.init(), PaymentOutbox.init()]);
  try {
    await Order.create({
      orderNumber: 'ORD-PAYMENT-TEST',
      userId: 'customer-1',
      tenantId,
      branchId: 'branch-1',
      deliveryAddress: 'Test address',
      paymentMethod: 'Online',
      paymentStatus: 'PENDING',
      finalTotal: 100,
      totalAmount: 100
    });
    const rawBody = Buffer.from('canonical-provider-event');
    const payloadHash = hashWebhookPayload(rawBody);
    const event = {
      provider: 'testpay',
      eventId: 'event-capture-123456',
      eventType: 'payment.captured',
      orderNumber: 'ORD-PAYMENT-TEST',
      tenantId,
      amountMinor: 10000,
      currency: 'INR',
      payloadHash,
      signatureVerified: true,
      platformFeeBps: 250
    };
    const first = await settleVerifiedPaymentCapture(event);
    assert.equal(first.duplicate, false);
    assert.equal(first.result.sellerNetMinor, 9750);
    assert.equal(first.result.platformFeeMinor, 250);

    const replay = await settleVerifiedPaymentCapture(event);
    assert.equal(replay.duplicate, true);
    assert.equal(await PaymentJournal.countDocuments({ orderNumber: 'ORD-PAYMENT-TEST' }), 1);
    assert.equal(await PaymentOutbox.countDocuments({ aggregateId: 'ORD-PAYMENT-TEST' }), 1);
    const savedOrder = await Order.findOne({ orderNumber: 'ORD-PAYMENT-TEST', tenantId }).lean();
    assert.equal(savedOrder.paymentStatus, 'PAID');
    assert.equal(savedOrder.amountPaid, 100);

    const secondProviderEvent = await settleVerifiedPaymentCapture({
      ...event, eventId: 'event-capture-654321',
      payloadHash: hashWebhookPayload(Buffer.from('second-capture-event'))
    });
    assert.equal(secondProviderEvent.status, 'IGNORED_DUPLICATE_CAPTURE');
    assert.equal(await PaymentJournal.countDocuments({ orderNumber: 'ORD-PAYMENT-TEST' }), 1);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
