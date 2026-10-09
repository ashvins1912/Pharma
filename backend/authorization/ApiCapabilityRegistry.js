/**
 * Backend API capability registry.
 *
 * authenticateUser enforces this registry automatically. Route handlers may
 * still use requirePermission() for extra resource/action checks.
 */
export const API_CAPABILITIES = [
  { method: 'GET', pattern: /^\/api\/coupons\/my-offer(?:\/|$)/, permission: 'orders.read' },
  { method: 'GET', pattern: /^\/api\/coupons\/admin\/(?:customers|customer-promotions)(?:\/|$)/, permission: 'promotions.read' },
  { method: 'POST', pattern: /^\/api\/coupons\/admin\/customer-promotions(?:\/|$)/, permission: 'promotions.manage' },
  { method: 'PATCH', pattern: /^\/api\/coupons\/admin\/customer-promotions\/[^/]+(?:\/|$)/, permission: 'promotions.manage' },

  { method: 'GET', pattern: /^\/api\/medicines\/admin\/inventory$/, permission: 'inventory.read' },
  { method: 'GET', pattern: /^\/api\/medicines\/alerts$/, permission: 'inventory.read' },
  { method: 'GET', pattern: /^\/api\/medicines\/audits$/, permission: 'inventory.read' },
  { method: 'GET', pattern: /^\/api\/medicines\/imports\/[^/]+\/(?:status|failed-records)$/, permission: 'inventory.read' },
  { method: 'POST', pattern: /^\/api\/medicines\/(?:imports|imports\/[^/]+\/retry|validate-import|confirm-import|upload-excel)$/, permission: 'inventory.import' },
  { method: 'POST', pattern: /^\/api\/medicines(?:\/|$)/, permission: 'inventory.write' },
  { method: 'PUT', pattern: /^\/api\/medicines\/[^/]+$/, permission: 'inventory.write' },
  { method: 'PATCH', pattern: /^\/api\/medicines\/[^/]+$/, permission: 'inventory.write' },
  { method: 'DELETE', pattern: /^\/api\/medicines\/[^/]+$/, permission: 'inventory.write' },

  { method: 'GET', pattern: /^\/api\/admin\/medicine-requests\/pending-count(?:\/|$)/, permission: 'medicine_requests.pending_count' },
  { method: 'GET', pattern: /^\/api\/admin\/medicine-requests(?:\/|$)/, permission: 'medicine_requests.read' },
  { method: 'GET', pattern: /^\/api\/medicine-requests\/admin\/all(?:\/|$)/, permission: 'medicine_requests.read' },
  { method: 'GET', pattern: /^\/api\/medicine-requests\/metrics(?:\/|$)/, permission: 'medicine_requests.read' },
  { method: 'GET', pattern: /^\/api\/medicine-requests\/my(?:\/|$)/, permission: 'medicine_requests.read' },
  { method: 'POST', pattern: /^\/api\/medicine-requests\/[^/]+\/proposal\/decision(?:\/|$)/, permission: 'medicine_requests.proposal' },
  { method: 'POST', pattern: /^\/api\/medicine-requests\/admin\/[^/]+\/proposal(?:\/|$)/, permission: 'medicine_requests.proposal' },
  { method: 'POST', pattern: /^\/api\/medicine-requests(?:\/|$)/, permission: 'medicine_requests.create' },
  { method: 'PUT', pattern: /^\/api\/medicine-requests\/[^/]+\/prescription(?:\/|$)/, permission: 'medicine_requests.create' },

  { method: 'GET', pattern: /^\/api\/orders\/admin(?:\/|$)/, permission: 'orders.read' },
  { method: 'GET', pattern: /^\/api\/orders(?:\/|$)/, permission: 'orders.read' },
  { method: 'POST', pattern: /^\/api\/orders\/checkout(?:\/|$)/, permission: 'orders.create' },
  { method: 'POST', pattern: /^\/api\/orders\/checkout\/quote(?:\/|$)/, permission: 'orders.create' },
  { method: 'POST', pattern: /^\/api\/orders\/admin(?:\/|$)/, permission: 'orders.manage' },
  { method: 'PUT', pattern: /^\/api\/orders\/[^/]+(?:\/|$)/, permission: 'orders.manage' },
  { method: 'PATCH', pattern: /^\/api\/orders\/[^/]+(?:\/|$)/, permission: 'orders.manage' },

  { method: 'GET', pattern: /^\/api\/medicines\/admin(?:\/|$)/, permission: 'inventory.read' },
  { method: 'GET', pattern: /^\/api\/medicines\/audits(?:\/|$)/, permission: 'inventory.read' },
  { method: 'POST', pattern: /^\/api\/medicines\/upload-excel(?:\/|$)/, permission: 'inventory.import' },
  { method: 'POST', pattern: /^\/api\/medicines(?:\/|$)/, permission: 'inventory.write' },
  { method: 'PUT', pattern: /^\/api\/medicines(?:\/|$)/, permission: 'inventory.write' },
  { method: 'PATCH', pattern: /^\/api\/medicines(?:\/|$)/, permission: 'inventory.write' },
  { method: 'DELETE', pattern: /^\/api\/medicines(?:\/|$)/, permission: 'inventory.write' },
  { method: 'GET', pattern: /^\/api\/v1\/inventory\/imports(?:\/|$)/, permission: 'inventory.import' },
  { method: 'POST', pattern: /^\/api\/v1\/inventory\/imports(?:\/|$)/, permission: 'inventory.import' },

  { method: 'GET', pattern: /^\/api\/(?:v1\/)?prescriptions(?:\/|$)/, permission: 'prescription.read' },
  { method: 'POST', pattern: /^\/api\/(?:v1\/)?prescriptions(?:\/|$)/, permission: 'prescription.write' },
  { method: 'PUT', pattern: /^\/api\/(?:v1\/)?prescriptions(?:\/|$)/, permission: 'prescription.write' },
  { method: 'PATCH', pattern: /^\/api\/(?:v1\/)?prescriptions(?:\/|$)/, permission: 'prescription.write' },

  { method: 'GET', pattern: /^\/api\/v1\/integrations(?:\/|$)/, permission: 'csquare.read' },
  { method: 'PUT', pattern: /^\/api\/v1\/integrations(?:\/|$)/, permission: 'csquare.manage' },
  { method: 'POST', pattern: /^\/api\/v1\/integrations\/test-connection(?:\/|$)/, permission: 'csquare.manage' },
  { method: 'POST', pattern: /^\/api\/v1\/integrations\/sync(?:\/|$)/, permission: 'csquare.sync' },

  { method: 'GET', pattern: /^\/api\/v1\/admin\/payments\/outstanding$/, permission: 'billing.read' },
  { method: 'POST', pattern: /^\/api\/v1\/admin\/payments\/reminders\/dispatch$/, permission: 'billing.write' },
  { method: 'GET', pattern: /^\/api\/v1\/billing(?:\/|$)/, permission: 'billing.read' },
  { method: 'POST', pattern: /^\/api\/v1\/billing(?:\/|$)/, permission: 'billing.write' },
  { method: 'PUT', pattern: /^\/api\/v1\/billing(?:\/|$)/, permission: 'billing.write' },
  { method: 'PATCH', pattern: /^\/api\/v1\/billing(?:\/|$)/, permission: 'billing.write' },
  { method: 'DELETE', pattern: /^\/api\/v1\/billing(?:\/|$)/, permission: 'billing.write' },

  { method: 'GET', pattern: /^\/api\/v1\/referrals(?:\/|$)/, permission: 'referrals.read' },
  { method: 'POST', pattern: /^\/api\/v1\/referrals(?:\/|$)/, permission: 'referrals.manage' },
  { method: 'PUT', pattern: /^\/api\/v1\/referrals(?:\/|$)/, permission: 'referrals.manage' },
  { method: 'PATCH', pattern: /^\/api\/v1\/referrals(?:\/|$)/, permission: 'referrals.manage' },

  { method: 'GET', pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/, permission: 'tenants.read' },
  { method: 'POST', pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/, permission: 'tenants.manage' },
  { method: 'PUT', pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/, permission: 'tenants.manage' },
  { method: 'PATCH', pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/, permission: 'tenants.manage' },
  { method: 'DELETE', pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/, permission: 'tenants.manage' },
  { method: 'GET', pattern: /^\/api\/v1\/profile\/access\/users(?:\/|$)/, permission: 'users.read' },
  { method: 'PATCH', pattern: /^\/api\/v1\/profile\/access\/users(?:\/|$)/, permission: 'users.manage' }
];

export function resolveApiCapability(method, url) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const path = String(url || '').split('?')[0];
  return API_CAPABILITIES.find(entry => entry.method === normalizedMethod && entry.pattern.test(path)) || null;
}
