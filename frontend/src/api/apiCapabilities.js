/**
 * Frontend API capability registry.
 *
 * This is the UX/preflight layer. The backend remains authoritative.
 * Add every protected API pattern here with its required permission.
 */
export const API_CAPABILITIES = [
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
