import express from 'express';
import { verifyPaymentWebhookSignature } from '../services/payment/PaymentWebhookSecurity.js';
import { hashWebhookPayload, settleVerifiedPaymentCapture } from '../services/payment/PaymentSettlementService.js';

const router = express.Router();
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.post('/:provider', asyncHandler(async (req, res) => {
  const provider = String(req.params.provider || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(provider)) {
    return res.status(400).json({ success: false, code: 'INVALID_PROVIDER', message: 'Payment provider identifier is invalid.' });
  }
  const secretName = `PAYMENT_WEBHOOK_SECRET_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const secret = process.env[secretName] || '';
  if (secret.length < 32) {
    return res.status(503).json({ success: false, code: 'PAYMENT_WEBHOOK_NOT_CONFIGURED', message: 'Payment webhook is not configured for this provider.' });
  }
  const verified = verifyPaymentWebhookSignature(
    req.rawBody,
    req.get('x-payment-signature'),
    req.get('x-payment-timestamp'),
    secret
  );
  if (!verified) {
    return res.status(401).json({ success: false, code: 'INVALID_PAYMENT_SIGNATURE', message: 'Payment webhook signature is invalid or expired.' });
  }
  const payload = req.body || {};
  const data = payload.data || {};
  const result = await settleVerifiedPaymentCapture({
    provider,
    eventId: payload.eventId || payload.id,
    eventType: payload.eventType || payload.type,
    orderNumber: data.orderNumber,
    tenantId: data.tenantId,
    amountMinor: Number(data.amountMinor),
    currency: data.currency || 'INR',
    payloadHash: hashWebhookPayload(req.rawBody),
    signatureVerified: true,
    requestId: req.requestId || null
  });
  return res.status(200).json({ success: true, data: result, requestId: req.requestId || null });
}));

router.use((error, req, res, _next) => {
  const status = Number(error.statusCode) || 500;
  if (status >= 500) {
    console.error('Payment webhook settlement failed', {
      requestId: req.requestId || null,
      provider: req.params?.provider || null,
      code: error.code || 'PAYMENT_WEBHOOK_FAILED'
    });
  }
  return res.status(status).json({
    success: false,
    code: error.code || 'PAYMENT_WEBHOOK_FAILED',
    message: status >= 500 ? 'Payment webhook could not be processed.' : error.message,
    requestId: req.requestId || null
  });
});

export default router;
