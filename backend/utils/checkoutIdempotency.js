import { createHash } from 'node:crypto';

/**
 * Build deterministic identifiers for one customer's checkout attempt.
 * The generated ObjectId-compatible value is stable across retries, while the
 * reservation key is scoped to the same customer and tenant.
 */
export function buildCheckoutIdentity({ userId, tenantId, idempotencyKey } = {}) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedKey = String(idempotencyKey || '').trim();
  if (!normalizedUserId || !normalizedTenantId || !normalizedKey) return null;

  const digest = createHash('sha256')
    .update(JSON.stringify([normalizedUserId, normalizedTenantId, normalizedKey]))
    .digest('hex');

  return {
    orderId: digest.slice(0, 24),
    reservationIdempotencyKey: `checkout-reservation:${digest}`
  };
}
