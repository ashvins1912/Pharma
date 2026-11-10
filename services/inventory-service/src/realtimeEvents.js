import { randomUUID } from 'node:crypto';

const CACHE_TIMEOUT_MS = 2500;

const sharedEventPublisher = {
  get enabled() {
    const baseUrl = String(process.env.CACHE_SERVICE_URL || '').trim();
    const token = String(process.env.CACHE_SERVICE_TOKEN || '');
    return /^https?:\/\//i.test(baseUrl) && token.length >= 32;
  },
  async publishEvent(channel, payload, target = {}) {
    const baseUrl = String(process.env.CACHE_SERVICE_URL || '').trim();
    const token = String(process.env.CACHE_SERVICE_TOKEN || '');
    const url = new URL('/v1/events', baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-cache-service-token': token
      },
      body: JSON.stringify({
        channel,
        payload,
        userId: target.userId || payload?.userId || payload?.recipientUserId || null,
        tenantId: target.tenantId || payload?.tenantId || null,
        riderId: target.riderId || payload?.riderId || null
      }),
      signal: AbortSignal.timeout(CACHE_TIMEOUT_MS)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Cache service returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }
    return response.status === 204 ? null : response.json();
  }
};

/**
 * Publish an inventory invalidation after a committed stock/catalogue mutation.
 * The event contains routing metadata only; clients reload the authoritative,
 * tenant/branch-scoped Inventory API snapshot.
 */
export async function publishInventoryChanged({
  tenantId,
  branchId,
  reason = 'inventory.updated',
  entityId = null
} = {}, cacheClient = sharedEventPublisher) {
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedTenantId || !normalizedBranchId) return false;
  if (!cacheClient?.enabled) return false;

  const payload = {
    eventId: randomUUID(),
    tenantId: normalizedTenantId,
    branchId: normalizedBranchId,
    reason: String(reason || 'inventory.updated').slice(0, 80),
    entityId: entityId == null ? null : String(entityId).slice(0, 128),
    occurredAt: new Date().toISOString()
  };
  try {
    await cacheClient.publishEvent('inventory_changed', payload, { tenantId: normalizedTenantId });
    return true;
  } catch (error) {
    console.warn('[InventoryRealtime] Event publish failed; snapshot will recover on reconnect:', error?.message || error);
    return false;
  }
}
