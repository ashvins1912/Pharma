/**
 * Frontend API capability registry.
 *
 * This is the UX/preflight layer. The backend remains authoritative.
 * Add every protected API pattern here with its required permission.
 * GET /api/medicines is intentionally absent: it is the sanitized public storefront catalog.
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
    method: 'POST',
    pattern: /^\/api\/v1\/inventory\/adjust$/,
    permission: 'inventory.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/orders\/[^/]+\/events$/,
    permission: 'orders.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/orders\/[^/]+\/status$/,
    permission: 'orders.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/orders(?:\/|$)/,
    permission: 'orders.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/orders\/?$/,
    permission: 'orders.create'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/prescriptions\/reviews\/queue$/,
    permission: 'prescription.review'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/prescriptions\/[^/]+\/review(?:\/(?:claim|approve|reject|wait))?$/,
    permission: 'prescription.review'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/prescriptions\/[^/]+\/(?:link-order|convert-to-order|remove)$/,
    permission: 'prescription.write'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/prescriptions\/hospitals$/,
    permission: 'prescription.write'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/inventory\/imports$/,
    permission: 'inventory.import'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/inventory\/imports\/[^/]+(?:\/failures(?:\/download)?)?$/,
    permission: 'inventory.import'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/inventory\/imports\/[^/]+\/retry$/,
    permission: 'inventory.import'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/inventory\/adjust$/,
    permission: 'inventory.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/admin\/payments\/outstanding$/,
    permission: 'billing.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/auth\/me$/,
    permission: 'profile.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/auth\/logout$/,
    permission: 'profile.write'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/v1\/auth\/(?:onboarding|complete-profile)$/,
    permission: 'profile.complete'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/auth\/mfa\/(?:enroll|confirm-enroll|mfa-disable)$/,
    permission: 'profile.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/profile\/access\/users(?:\/|$)/,
    permission: 'users.read'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/profile\/access\/users(?:\/|$)/,
    permission: 'users.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/,
    permission: 'tenants.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/v1\/admin\/tenants(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/,
    permission: 'tenants.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/vendors?(?:\/|$)/,
    permission: 'tenants.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/vendors?(?:\/|$)/,
    permission: 'tenants.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/customers(?:\/|$)/,
    permission: 'profile.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/customers(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/customers(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/catalog(?:\/|$)/,
    permission: 'inventory.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/pricing(?:\/|$)/,
    permission: 'orders.read'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/delivery(?:\/|$)/,
    permission: 'delivery.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/delivery(?:\/|$)/,
    permission: 'delivery.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/delivery(?:\/|$)/,
    permission: 'delivery.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/medicine-requests(?:\/|$)/,
    permission: 'medicine_requests.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/medicine-requests(?:\/|$)/,
    permission: 'medicine_requests.create'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/integrations\/sync(?:\/|$)/,
    permission: 'csquare.sync'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/integrations(?:\/|$)/,
    permission: 'csquare.read'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/v1\/integrations(?:\/|$)/,
    permission: 'csquare.manage'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/integrations(?:\/|$)/,
    permission: 'csquare.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/notifications(?:\/|$)/,
    permission: 'profile.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/notifications(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/v1\/profile(?:\/|$)/,
    permission: 'profile.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/profile(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'PUT',
    pattern: /^\/api\/v1\/profile(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/v1\/profile(?:\/|$)/,
    permission: 'profile.write'
  },
  {
    method: 'POST',
    pattern: /^\/api\/v1\/admin\/payments\/reminders\/dispatch$/,
    permission: 'billing.write'
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/riders(?:\/|$)/,
    permission: 'delivery.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/riders(?:\/|$)/,
    permission: 'delivery.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/admin\/riders(?:\/|$)/,
    permission: 'delivery.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/assignment\/engine-status$/,
    permission: 'delivery.read'
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/assignment(?:\/|$)/,
    permission: 'delivery.manage'
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/admin\/assignment(?:\/|$)/,
    permission: 'delivery.manage'
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/audit-logs(?:\/|$)/,
    permission: 'users.read'
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
