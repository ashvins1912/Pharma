import { createHash, randomUUID } from 'node:crypto';
import Order from '../../models/Order.js';
import PaymentIntent from '../../models/PaymentIntent.js';
import { resolveTenantPaymentProvider } from './TenantPaymentProviderService.js';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const hashId = value => createHash('sha256').update(String(value)).digest('hex');

async function providerRequest(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw fail(502, 'PAYMENT_PROVIDER_ERROR', body.message || body.description || 'Payment provider rejected the request.');
  return body;
}

async function buildCheckout(provider, environment, credentials, order, amountMinor, idempotencyKey, returnUrl, notifyUrl) {
  const orderNumber = String(order.orderNumber);
  if (provider === 'razorpay') {
    const auth = Buffer.from(credentials.keyId + ':' + credentials.keySecret).toString('base64');
    const receipt = (orderNumber.slice(0, 22) + '-' + hashId(idempotencyKey).slice(0, 12)).slice(0, 40);
    const body = await providerRequest('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { authorization: 'Basic ' + auth, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: amountMinor, currency: 'INR', receipt, notes: { tenantId: String(order.tenantId), orderNumber } })
    });
    return { providerOrderId: body.id, checkout: { provider, keyId: credentials.keyId, orderId: body.id, amount: amountMinor, currency: 'INR' } };
  }

  if (provider === 'cashfree') {
    const phone = String(order.customerMobile || '').replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(phone)) throw fail(400, 'CUSTOMER_PHONE_REQUIRED', 'A valid ten-digit customer mobile number is required for Cashfree checkout.');
    const base = environment === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
    const providerOrderId = 'ph_' + hashId(order.tenantId + ':' + orderNumber + ':' + idempotencyKey).slice(0, 28);
    const body = await providerRequest(base + '/orders', {
      method: 'POST',
      headers: {
        'x-client-id': credentials.clientId,
        'x-client-secret': credentials.clientSecret,
        'x-api-version': '2025-01-01',
        'content-type': 'application/json',
        'x-idempotency-key': hashId(order.tenantId + ':' + idempotencyKey)
      },
      body: JSON.stringify({
        order_id: providerOrderId,
        order_amount: amountMinor / 100,
        order_currency: 'INR',
        customer_details: { customer_id: String(order.userId), customer_phone: phone },
        order_meta: { return_url: returnUrl, notify_url: notifyUrl },
        order_note: 'Pharmacy order ' + orderNumber
      })
    });
    return { providerOrderId: body.order_id, checkout: { provider, paymentSessionId: body.payment_session_id, environment } };
  }

  if (provider === 'payu') {
    const email = String(order.customerEmail || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'CUSTOMER_EMAIL_REQUIRED', 'A valid customer email is required for PayU checkout.');
    const txnid = 'PH' + hashId(order.tenantId + ':' + orderNumber + ':' + idempotencyKey).slice(0, 18);
    const amount = (amountMinor / 100).toFixed(2);
    const productinfo = 'Pharmacy order ' + orderNumber;
    const firstname = String(order.customerName || 'Customer').slice(0, 60);
    const udf1 = String(order.tenantId);
    const udf2 = orderNumber;
    const hashFields = [credentials.merchantKey, txnid, amount, productinfo, firstname, email, udf1, udf2, '', '', ''];
    const hash = createHash('sha512').update(hashFields.join('|') + '||||||' + credentials.merchantSalt).digest('hex');
    return {
      providerOrderId: txnid,
      checkout: {
        provider, method: 'POST',
        action: environment === 'production' ? 'https://secure.payu.in/_payment' : 'https://test.payu.in/_payment',
        fields: { key: credentials.merchantKey, txnid, amount, productinfo, firstname, email, surl: returnUrl, furl: returnUrl, hash, udf1, udf2 }
      }
    };
  }
  throw fail(400, 'UNSUPPORTED_PAYMENT_PROVIDER', 'No checkout adapter is registered for this provider.');
}

export async function createTenantCheckout({ user, orderNumber, idempotencyKey, environment = 'sandbox' }) {
  const identity = String(user?.sub || user?.id || user?.userId || '');
  const key = String(idempotencyKey || '').trim();
  if (!identity || !key || key.length > 128) throw fail(400, 'INVALID_CHECKOUT_REQUEST', 'Authenticated customer and Idempotency-Key are required.');
  if (!['sandbox', 'production'].includes(environment)) throw fail(400, 'INVALID_PAYMENT_ENVIRONMENT', 'Choose sandbox or production.');
  if (environment === 'production' && process.env.PAYMENT_PROVIDER_LIVE_CHECKOUT_ENABLED !== 'true') {
    throw fail(503, 'LIVE_PAYMENT_CHECKOUT_DISABLED', 'Live checkout is disabled until provider-specific webhook verification and reconciliation are enabled.');
  }

  const order = await Order.findOne({ orderNumber: String(orderNumber || '').trim(), userId: identity }).lean();
  if (!order) throw fail(404, 'ORDER_NOT_FOUND', 'Order not found for this customer.');
  const tenantId = String(order.tenantId || '');
  if (!tenantId) throw fail(409, 'ORDER_TENANT_REQUIRED', 'Order is missing tenant ownership.');
  if (order.paymentStatus === 'PAID') throw fail(409, 'ORDER_ALREADY_PAID', 'Order is already paid.');
  if (/\bcod\b|cash\s*on\s*delivery/i.test(String(order.paymentMethod || ''))) throw fail(409, 'COD_ORDER_NOT_PAYABLE_ONLINE', 'This order is cash on delivery.');
  const amountMinor = Math.round(Number(order.finalTotal ?? order.totalAmount) * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw fail(400, 'INVALID_ORDER_AMOUNT', 'Order amount is invalid.');

  const prior = await PaymentIntent.findOne({ tenantId, idempotencyKey: key }).lean();
  if (prior) {
    if (prior.orderNumber !== order.orderNumber) throw fail(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key belongs to another order.');
    if (prior.status === 'CREATED') return { ...prior.checkout, paymentIntentId: String(prior._id), reused: true };
    throw fail(409, 'PAYMENT_ATTEMPT_IN_PROGRESS', 'Existing payment attempt requires reconciliation before retry.');
  }

  const config = await resolveTenantPaymentProvider({ tenantId, environment });
  const returnUrl = String(process.env.PAYMENT_RETURN_URL || '');
  const webhookBase = String(process.env.PAYMENT_WEBHOOK_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(returnUrl) || !/^https:\/\//i.test(webhookBase)) {
    throw fail(503, 'PAYMENT_CALLBACK_URLS_NOT_CONFIGURED', 'Configure HTTPS payment return and webhook URLs.');
  }

  let intent;
  try {
    intent = await PaymentIntent.create({
      tenantId, orderNumber: order.orderNumber, customerId: identity,
      provider: config.provider, environment: config.environment,
      idempotencyKey: key, amountMinor, currency: 'INR', status: 'CREATING'
    });
  } catch (error) {
    if (error?.code === 11000) {
      const concurrent = await PaymentIntent.findOne({ tenantId, idempotencyKey: key }).lean();
      if (concurrent?.status === 'CREATED') return { ...concurrent.checkout, paymentIntentId: String(concurrent._id), reused: true };
      throw fail(409, 'PAYMENT_ATTEMPT_IN_PROGRESS', 'A payment attempt with this key is already being created.');
    }
    throw error;
  }

  try {
    const result = await buildCheckout(config.provider, config.environment, config.credentials, order, amountMinor, key, returnUrl, webhookBase + '/webhooks/payments/' + config.provider);
    intent.providerOrderId = result.providerOrderId;
    intent.checkout = result.checkout;
    intent.status = 'CREATED';
    await intent.save();
    return { ...result.checkout, paymentIntentId: String(intent._id), reused: false };
  } catch (error) {
    intent.status = 'FAILED';
    await intent.save().catch(() => {});
    throw error;
  }
}
