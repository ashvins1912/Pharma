/**
 * Frontend API capability registry.
 *
 * This is the UX/preflight layer. The backend remains authoritative.
 * Add every protected API pattern here with its required permission.
 */
export const API_CAPABILITIES = [
  {
    method: 'GET',
    pattern: /^\/api\/orders\/[^/]+\/scan-prescription$/,
    permission: 'prescription.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/orders\/notifications\/logs$/,
    permission: 'whatsapp.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/orders\/[^/]+\/notify-whatsapp$/,
    permission: 'whatsapp.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/[^/]+\/notify-whatsapp$/,
    permission: 'whatsapp.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/[^/]+\/rating$/,
    permission: 'orders.read'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/orders\/[^/]+\/review$/,
    permission: 'prescription.review'
  },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/admin\/[^/]+\/prescription\/(?:reinitiate|manual-approve)$/,
    permission: 'prescription.review'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/orders\/[^/]+\/dispatch$/,
    permission: 'delivery.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/admin\/(?:optimize-and-club-routes|dispatch-batch)$/,
    permission: 'delivery.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/admin(?:\/|$)/,
    permission: 'orders.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/checkout(?:\/quote)?$/,
    permission: 'orders.create'
  },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/?$/,
    permission: 'orders.create'
  },
  {
    method: 'GET',
    pattern: /^\/api\/orders\/admin(?:\/|$)/,
    permission: 'orders.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/orders(?:\/|$)/,
    permission: 'orders.read'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/orders\/[^/]+(?:\/|$)/,
    permission: 'orders.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/orders\/[^/]+(?:\/|$)/,
    permission: 'orders.manage'
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/orders\/[^/]+(?:\/|$)/,
    permission: 'orders.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/profile(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/profile(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/profile(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/profile(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'POST',
    pattern: /^\/api\/riders\/?$/,
    permission: 'delivery.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/riders(?:\/|$)/,
    permission: 'delivery.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/coupons\/?$/,
    permission: 'promotions.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/medicines\/admin\/inventory$/,
    permission: 'inventory.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/medicines\/(?:alerts|audits)$/,
    permission: 'inventory.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/medicines\/imports\/[^/]+\/(?:status|failed-records)$/,
    permission: 'inventory.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/medicines\/(?:imports|imports\/[^/]+\/retry|validate-import|confirm-import|upload-excel)$/,
    permission: 'inventory.import'
  },
  {
    method: 'POST',
    pattern: /^\/api\/medicines\/?$/,
    permission: 'inventory.write'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/medicines\/[^/]+$/,
    permission: 'inventory.write'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/medicines\/[^/]+$/,
    permission: 'inventory.write'
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/medicines\/[^/]+$/,
    permission: 'inventory.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/admin\/payments\/outstanding$/,
    permission: 'billing.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/admin\/payments\/reminders\/dispatch$/,
    permission: 'billing.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/whatsapp\/(?:status|logs)(?:\/|$)/,
    permission: 'whatsapp.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/whatsapp\/(?:generate-qr|disconnect)(?:\/|$)/,
    permission: 'whatsapp.manage'
  },

  {
    method: 'GET',
    pattern: /^\/api\/coupons\/my-offer(?:\/|$)/,
    permission: 'orders.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/coupons\/admin\/(?:customers|customer-promotions)(?:\/|$)/,
    permission: 'promotions.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/coupons\/admin\/customer-promotions(?:\/|$)/,
    permission: 'promotions.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/coupons\/admin\/customer-promotions\/[^/]+(?:\/|$)/,
    permission: 'promotions.manage'
  },

  {
    method: 'GET',
    pattern: /^\/api\/admin\/medicine-requests\/pending-count(?:\/|$)/,
    permission: 'medicine_requests.pending_count'
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/medicine-requests(?:\/|$)/,
    permission: 'medicine_requests.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/medicine-requests\/admin\/all(?:\/|$)/,
    permission: 'medicine_requests.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/medicine-requests\/metrics(?:\/|$)/,
    permission: 'medicine_requests.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/medicine-requests\/[^/]+\/scan-prescription(?:\/|$)/,
    permission: 'medicine_requests.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/medicine-requests\/my(?:\/|$)/,
    permission: 'medicine_requests.read'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/admin\/medicine-requests\/[^/]+\/review(?:\/|$)/,
    permission: 'medicine_requests.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/medicine-requests\/[^/]+\/proposal(?:\/|$)/,
    permission: 'medicine_requests.proposal'
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/medicine-requests\/[^/]+\/reject-request(?:\/|$)/,
    permission: 'medicine_requests.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/medicine-requests\/[^/]+\/proposal\/decision(?:\/|$)/,
    permission: 'medicine_requests.proposal'
  },
  {
    method: 'POST',
    pattern: /^\/api\/medicine-requests\/admin\/[^/]+\/proposal(?:\/|$)/,
    permission: 'medicine_requests.proposal'
  },
  {
    method: 'POST',
    pattern: /^\/api\/medicine-requests(?:\/|$)/,
    permission: 'medicine_requests.create'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/medicine-requests\/[^/]+\/prescription(?:\/|$)/,
    permission: 'medicine_requests.create'
  }
];

export function resolveApiCapability(method, url) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const path = String(url || '').split('?')[0];
  return API_CAPABILITIES.find(
    entry => entry.method === normalizedMethod && entry.pattern.test(path)
  ) || null;
}
