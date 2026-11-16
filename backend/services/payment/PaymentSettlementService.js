import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import Order from '../../models/Order.js';
import PaymentWebhookEvent from '../../models/PaymentWebhookEvent.js';
import PaymentJournal from '../../models/PaymentJournal.js';
import PaymentOutbox from '../../models/PaymentOutbox.js';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

export function buildCaptureJournal({ provider, eventId, orderNumber, tenantId, currency = 'INR', amountMinor, platformFeeBps = 0, postedAt = new Date() }) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw fail(400, 'INVALID_AMOUNT', 'Capture amount must be a positive integer in minor currency units.');
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10000) throw fail(500, 'INVALID_FEE_POLICY', 'Platform fee basis points must be between 0 and 10000.');
  const platformFeeMinor = Math.floor(amountMinor * platformFeeBps / 10000);
  const sellerNetMinor = amountMinor - platformFeeMinor;
  const entries = [
    { accountCode: 'GATEWAY_CLEARING', side: 'DEBIT', amountMinor }
  ];
  if (sellerNetMinor > 0) entries.push({
    accountCode: 'SELLER_PAYABLE',
    side: 'CREDIT',
    amountMinor: sellerNetMinor,
    partyId: String(tenantId)
  });
  if (platformFeeMinor > 0) entries.push({
    accountCode: 'PLATFORM_FEE_REVENUE',
    side: 'CREDIT',
    amountMinor: platformFeeMinor
  });
  const debits = entries.filter(entry => entry.side === 'DEBIT').reduce((sum, entry) => sum + entry.amountMinor, 0);
  const credits = entries.filter(entry => entry.side === 'CREDIT').reduce((sum, entry) => sum + entry.amountMinor, 0);
  if (debits !== credits) throw fail(500, 'UNBALANCED_JOURNAL', 'Payment journal is not balanced.');
  return {
    journalId: `JRN-${randomUUID()}`,
    idempotencyKey: `payment-capture:${provider}:${eventId}`,
    provider,
    providerEventId: eventId,
    orderNumber,
    tenantId: String(tenantId),
    currency: String(currency).toUpperCase(),
    totalMinor: amountMinor,
    entries,
    postedAt,
    sellerNetMinor,
    platformFeeMinor
  };
}

const replayEvent = (event, payloadHash) => {
  if (event.payloadHash !== payloadHash) {
    throw fail(409, 'WEBHOOK_EVENT_COLLISION', 'Provider event ID was reused with a different payload.');
  }
  return { duplicate: true, status: event.status, result: event.result };
};

export async function settleVerifiedPaymentCapture({
  provider, eventId, eventType, orderNumber, tenantId, amountMinor, currency = 'INR',
  payloadHash, signatureVerified = false, requestId = null,
  platformFeeBps = Number.parseInt(process.env.PLATFORM_FEE_BPS || '0', 10)
}) {
  if (signatureVerified !== true) throw fail(401, 'UNVERIFIED_WEBHOOK', 'A provider signature must be verified before settlement.');
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedEventId = String(eventId || '').trim();
  const normalizedOrderNumber = String(orderNumber || '').trim();
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedCurrency = String(currency || '').trim().toUpperCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(normalizedProvider)
    || normalizedEventId.length < 6 || normalizedEventId.length > 200
    || !normalizedOrderNumber || normalizedOrderNumber.length > 100
    || !normalizedTenantId || normalizedTenantId.length > 128
    || !Number.isSafeInteger(amountMinor) || amountMinor < 1
    || !/^[A-Z]{3}$/.test(normalizedCurrency)
    || typeof payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(payloadHash)) {
    throw fail(400, 'INVALID_PAYMENT_EVENT', 'Payment capture event is incomplete or invalid.');
  }
  if (String(eventType) !== 'payment.captured') {
    throw fail(400, 'UNSUPPORTED_PAYMENT_EVENT', 'Only normalized payment.captured events are accepted by this settlement operation.');
  }
  if (normalizedCurrency !== 'INR') {
    throw fail(409, 'UNSUPPORTED_CURRENCY', 'This settlement ledger currently supports INR only.');
  }

  const session = await mongoose.startSession();
  let outcome;
  try {
    await session.withTransaction(async () => {
      outcome = null;
      const existing = await PaymentWebhookEvent.findOne({
        provider: normalizedProvider, eventId: normalizedEventId
      }).session(session).lean();
      if (existing) {
        outcome = replayEvent(existing, payloadHash);
        return;
      }

      const order = await Order.findOne({
        orderNumber: normalizedOrderNumber,
        tenantId: normalizedTenantId
      }).session(session);
      if (!order) throw fail(404, 'ORDER_NOT_FOUND', 'The payment order was not found in the supplied seller tenant.');
      if (/cash\s*on\s*delivery|\bcod\b/i.test(String(order.paymentMethod || ''))) {
        throw fail(409, 'COD_ORDER_NOT_PAYABLE_ONLINE', 'Cash-on-delivery orders cannot be settled through an online payment capture.');
      }
      const orderAmountMinor = Math.round(Number(order.finalTotal ?? order.totalAmount) * 100);
      if (!Number.isSafeInteger(orderAmountMinor) || orderAmountMinor !== amountMinor) {
        throw fail(409, 'PAYMENT_AMOUNT_MISMATCH', 'Captured amount does not match the order total.');
      }

      const now = new Date();
      if (order.paymentStatus === 'PAID') {
        const result = { orderNumber: normalizedOrderNumber, paymentStatus: 'PAID', alreadySettled: true };
        await PaymentWebhookEvent.create([{
          provider: normalizedProvider, eventId: normalizedEventId, eventType,
          payloadHash, orderNumber: normalizedOrderNumber, tenantId: normalizedTenantId,
          amountMinor, currency: normalizedCurrency, status: 'IGNORED_DUPLICATE_CAPTURE',
          result, processedAt: now
        }], { session });
        outcome = { duplicate: true, status: 'IGNORED_DUPLICATE_CAPTURE', result };
        return;
      }

      const journal = buildCaptureJournal({
        provider: normalizedProvider, eventId: normalizedEventId,
        orderNumber: normalizedOrderNumber, tenantId: normalizedTenantId,
        currency: normalizedCurrency, amountMinor, platformFeeBps, postedAt: now
      });
      await PaymentJournal.create([{
        journalId: journal.journalId,
        idempotencyKey: journal.idempotencyKey,
        provider: normalizedProvider,
        providerEventId: normalizedEventId,
        orderNumber: normalizedOrderNumber,
        tenantId: normalizedTenantId,
        currency: normalizedCurrency,
        totalMinor: amountMinor,
        entries: journal.entries,
        postedAt: now
      }], { session });

      order.paymentStatus = 'PAID';
      order.amountPaid = amountMinor / 100;
      await order.save({ session });

      const result = {
        orderNumber: normalizedOrderNumber,
        paymentStatus: 'PAID',
        amountMinor,
        currency: normalizedCurrency,
        journalId: journal.journalId,
        sellerNetMinor: journal.sellerNetMinor,
        platformFeeMinor: journal.platformFeeMinor
      };
      await PaymentWebhookEvent.create([{
        provider: normalizedProvider, eventId: normalizedEventId, eventType,
        payloadHash, orderNumber: normalizedOrderNumber, tenantId: normalizedTenantId,
        amountMinor, currency: normalizedCurrency, status: 'PROCESSED',
        result, processedAt: now
      }], { session });
      await PaymentOutbox.create([{
        eventKey: `payment-captured:${normalizedProvider}:${normalizedEventId}`,
        eventType: 'PAYMENT_CAPTURED',
        aggregateId: normalizedOrderNumber,
        tenantId: normalizedTenantId,
        payload: { ...result, provider: normalizedProvider, requestId }
      }], { session });
      outcome = { duplicate: false, status: 'PROCESSED', result };
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await PaymentWebhookEvent.findOne({
        provider: normalizedProvider, eventId: normalizedEventId
      }).lean();
      if (existing) return replayEvent(existing, payloadHash);
    }
    if (error.hasErrorLabel?.('TransientTransactionError') || error.hasErrorLabel?.('UnknownTransactionCommitResult')) {
      error.statusCode = 503;
      error.code = 'PAYMENT_TRANSACTION_RETRY_REQUIRED';
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return outcome;
}

export function hashWebhookPayload(rawBody) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError('Raw webhook body is required.');
  return createHash('sha256').update(rawBody).digest('hex');
}
