import express from 'express';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import PaymentIntent from '../models/PaymentIntent.js';
import { resolveTenantPaymentProviderCredentials } from '../services/payment/TenantPaymentProviderService.js';
import { hashWebhookPayload, settleVerifiedPaymentCapture } from '../services/payment/PaymentSettlementService.js';

const router = express.Router();
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const equal = (expected, supplied) => {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
};
const minor = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'INVALID_PAYMENT_AMOUNT', 'Provider amount is invalid.');
  const result = Math.round(amount * 100);
  if (!Number.isSafeInteger(result)) throw fail(400, 'INVALID_PAYMENT_AMOUNT', 'Provider amount is invalid.');
  return result;
};

async function normalizeAndVerify(provider, req) {
  const body = req.body || {};
  if (provider === 'razorpay') {
    if (body.event !== 'payment.captured') return null;
    const payment = body.payload?.payment?.entity;
    if (!payment?.order_id || !payment?.id) throw fail(400, 'INVALID_RAZORPAY_EVENT', 'Razorpay capture payload is incomplete.');
    const intent = await PaymentIntent.findOne({ provider, providerOrderId: payment.order_id }).lean();
    if (!intent) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'No matching tenant payment intent was found.');
    const credentials = await resolveTenantPaymentProviderCredentials({ tenantId: intent.tenantId, provider, environment: intent.environment });
    const signature = req.get('x-razorpay-signature') || '';
    const expected = createHmac('sha256', credentials.webhookSecret).update(req.rawBody).digest('hex');
    if (!equal(expected.toLowerCase(), signature.toLowerCase())) throw fail(401, 'INVALID_PAYMENT_SIGNATURE', 'Razorpay webhook signature is invalid.');
    const eventId = req.get('x-razorpay-event-id') || '';
    if (eventId.length < 6) throw fail(400, 'WEBHOOK_EVENT_ID_REQUIRED', 'Razorpay event ID header is required.');
    return { intent, eventId, eventType: body.event, amountMinor: Number(payment.amount), currency: payment.currency || 'INR' };
  }

  if (provider === 'cashfree') {
    if (!['PAYMENT_SUCCESS_WEBHOOK', 'PAYMENT_SUCCESS'].includes(String(body.type || '').toUpperCase())) return null;
    const order = body.data?.order, payment = body.data?.payment;
    if (!order?.order_id || !payment?.cf_payment_id) throw fail(400, 'INVALID_CASHFREE_EVENT', 'Cashfree payment payload is incomplete.');
    const intent = await PaymentIntent.findOne({ provider, providerOrderId: order.order_id }).lean();
    if (!intent) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'No matching tenant payment intent was found.');
    const credentials = await resolveTenantPaymentProviderCredentials({ tenantId: intent.tenantId, provider, environment: intent.environment });
    const timestamp = req.get('x-webhook-timestamp') || '';
    const signature = req.get('x-webhook-signature') || '';
    const expected = createHmac('sha256', credentials.webhookSecret).update(timestamp + req.rawBody.toString('utf8')).digest('base64');
    if (!timestamp || !equal(expected, signature)) throw fail(401, 'INVALID_PAYMENT_SIGNATURE', 'Cashfree webhook signature is invalid.');
    const paymentStatus = String(payment.payment_status || '').toUpperCase();
    if (paymentStatus !== 'SUCCESS') return null;
    return { intent, eventId: String(payment.cf_payment_id), eventType: 'payment.captured', amountMinor: minor(payment.payment_amount ?? order.order_amount), currency: order.order_currency || 'INR' };
  }

  if (provider === 'payu') {
    const p = body;
    if (String(p.status || '').toLowerCase() !== 'success' || !['captured', 'success'].includes(String(p.unmappedstatus || 'captured').toLowerCase())) return null;
    if (!p.txnid || !p.mihpayid || !p.hash) throw fail(400, 'INVALID_PAYU_EVENT', 'PayU callback payload is incomplete.');
    const intent = await PaymentIntent.findOne({ provider, providerOrderId: String(p.txnid) }).lean();
    if (!intent || String(p.udf1 || '') !== String(intent.tenantId) || String(p.udf2 || '') !== String(intent.orderNumber)) throw fail(404, 'PAYMENT_INTENT_NOT_FOUND', 'PayU callback does not match a tenant payment intent.');
    const credentials = await resolveTenantPaymentProviderCredentials({ tenantId: intent.tenantId, provider, environment: intent.environment });
    const reverseFields = [
      credentials.merchantSalt, p.status, '', '', '', '', '',
      p.udf5 || '', p.udf4 || '', p.udf3 || '', p.udf2 || '', p.udf1 || '',
      p.email || '', p.firstname || '', p.productinfo || '', p.amount || '', p.txnid, p.key || ''
    ];
    const expected = createHash('sha512').update(reverseFields.join('|')).digest('hex');
    if (!equal(expected.toLowerCase(), String(p.hash).toLowerCase())) throw fail(401, 'INVALID_PAYMENT_SIGNATURE', 'PayU callback hash is invalid.');
    return { intent, eventId: String(p.mihpayid), eventType: 'payment.captured', amountMinor: minor(p.amount), currency: 'INR' };
  }

  throw fail(400, 'UNSUPPORTED_PAYMENT_PROVIDER', 'Payment provider is not supported.');
}

router.post('/:provider', async (req, res) => {
  try {
    const provider = String(req.params.provider || '').trim().toLowerCase();
    if (!['razorpay', 'cashfree', 'payu'].includes(provider)) return res.status(400).json({ success: false, code: 'INVALID_PROVIDER' });
    if (!Buffer.isBuffer(req.rawBody)) throw fail(400, 'RAW_WEBHOOK_BODY_REQUIRED', 'Raw provider webhook body is required.');
    const normalized = await normalizeAndVerify(provider, req);
    if (!normalized) return res.status(200).json({ success: true, ignored: true });
    const result = await settleVerifiedPaymentCapture({
      provider, eventId: normalized.eventId, eventType: normalized.eventType,
      orderNumber: normalized.intent.orderNumber, tenantId: normalized.intent.tenantId,
      amountMinor: normalized.amountMinor, currency: normalized.currency,
      payloadHash: hashWebhookPayload(req.rawBody), signatureVerified: true,
      requestId: req.requestId || null
    });
    if (!result.duplicate) await PaymentIntent.updateOne({ _id: normalized.intent._id, tenantId: normalized.intent.tenantId }, { $set: { status: 'PAID' } });
    return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
  } catch (error) {
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error('Payment webhook settlement failed', { requestId: req.requestId || null, provider: req.params?.provider || null, code: error.code || 'PAYMENT_WEBHOOK_FAILED' });
    return res.status(status).json({ success: false, code: error.code || 'PAYMENT_WEBHOOK_FAILED', message: status >= 500 ? 'Payment webhook could not be processed.' : error.message, requestId: req.requestId || null });
  }
});

export default router;
