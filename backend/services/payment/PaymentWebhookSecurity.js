import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPaymentWebhookSignature(rawBody, signature, timestamp, secret, { now = Date.now(), toleranceSeconds = 300 } = {}) {
  if (!Buffer.isBuffer(rawBody) || typeof secret !== 'string' || secret.length < 32) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > toleranceSeconds) return false;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(`${seconds}.`).update(rawBody).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
