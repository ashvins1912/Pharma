import { randomUUID } from 'node:crypto';
import { sharedCache } from '../../../packages/shared-cache/index.js';

/**
 * Publish an inventory invalidation event after a committed stock/catalogue
 * mutation. The payload contains routing metadata only; clients reload the
 * authoritative, tenant/branch-scoped Inventory API snapshot.
 */
export async function publishInventoryChanged({
  tenantId,
  branchId,
  reason = 'inventory.updated',
  entityId = null
} = {}, cacheClient = sharedCache) {
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedTenantId || !normalizedBranchId) return false;
  if (!cacheClient?.enabled) {
    // Do not fail a successful inventory write because realtime transport is
    // temporarily unavailable. The client will recover its snapshot on reconnect.
    return false;
  }

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
