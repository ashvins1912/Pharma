const CAPABILITIES = [
  ['GET', /^\/api\/orders(?:\/|$)/, 'orders.read'],
  ['POST', /^\/api\/orders\/checkout(?:\/|$)/, 'orders.create'],
  ['POST', /^\/api\/orders\/checkout\/quote(?:\/|$)/, 'orders.create'],
  ['POST', /^\/api\/orders\/admin(?:\/|$)/, 'orders.manage'],
  ['PUT', /^\/api\/orders\/[^/]+(?:\/|$)/, 'orders.manage'],
  ['PATCH', /^\/api\/orders\/[^/]+(?:\/|$)/, 'orders.manage'],
  ['GET', /^\/api\/medicine-requests(?:\/|$)/, 'medicine_requests.read'],
  ['POST', /^\/api\/medicine-requests(?:\/|$)/, 'medicine_requests.create'],
  ['PUT', /^\/api\/medicine-requests\/[^/]+\/prescription(?:\/|$)/, 'medicine_requests.create'],
  ['POST', /^\/api\/medicine-requests\/[^/]+\/proposal(?:\/|$)/, 'medicine_requests.proposal'],
  ['POST', /^\/api\/medicine-requests\/admin\/[^/]+\/proposal(?:\/|$)/, 'medicine_requests.proposal'],
  ['GET', /^\/api\/admin\/medicine-requests(?:\/|$)/, 'medicine_requests.read'],
  ['GET', /^\/api\/medicines(?:\/|$)/, 'inventory.read'],
  ['POST', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['PUT', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['PATCH', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['DELETE', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['GET', /^\/api\/coupons\/my-offer(?:\/|$)/, 'orders.read'],
  ['GET', /^\/api\/coupons\/admin\/(?:customers|customer-promotions)(?:\/|$)/, 'promotions.read'],
  ['POST', /^\/api\/coupons\/admin\/customer-promotions(?:\/|$)/, 'promotions.manage'],
  ['PATCH', /^\/api\/coupons\/admin\/customer-promotions\/[^/]+(?:\/|$)/, 'promotions.manage'],
  ['GET', /^\/api\/user\/profile(?:\/|$)/, 'profile.read'],
  ['POST', /^\/api\/user\/profile(?:\/|$)/, 'profile.write'],
  ['GET', /^\/api\/user\/addresses(?:\/|$)/, 'profile.read'],
  ['POST', /^\/api\/user\/addresses(?:\/|$)/, 'profile.write'],
  ['PATCH', /^\/api\/user\/addresses\/[^/]+(?:\/|$)/, 'profile.write'],
  ['DELETE', /^\/api\/user\/addresses\/[^/]+(?:\/|$)/, 'profile.write'],
  ['GET', /^\/api\/profile(?:\/|$)/, 'profile.read'],
  ['PATCH', /^\/api\/profile(?:\/|$)/, 'profile.write'],
  ['GET', /^\/api\/riders(?:\/|$)/, 'delivery.read'],
  ['GET', /^\/api\/admin\/riders(?:\/|$)/, 'delivery.read'],
  ['POST', /^\/api\/admin\/riders(?:\/|$)/, 'delivery.manage'],
  ['PATCH', /^\/api\/admin\/riders(?:\/|$)/, 'delivery.manage'],
  ['POST', /^\/api\/admin\/assignment(?:\/|$)/, 'delivery.manage'],
  ['PATCH', /^\/api\/admin\/assignment(?:\/|$)/, 'delivery.manage'],
  ['GET', /^\/api\/admin\/audit-logs(?:\/|$)/, 'users.read']
];

const PUBLIC_PATHS = [/^\/api\/v1\/auth(?:\/|$)/, /^\/api\/public\//, /^\/api\/vendors\//, /^\/api\/vendor\//];

export function resolveGatewayCapability(method, url) {
  const path = String(url || '').split('?')[0];
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (PUBLIC_PATHS.some(pattern => pattern.test(path))) return null;
  return CAPABILITIES.find(([m, pattern]) => m === normalizedMethod && pattern.test(path))?.[2] || null;
}

export function isGatewayPublicPath(url) {
  const path = String(url || '').split('?')[0];
  return PUBLIC_PATHS.some(pattern => pattern.test(path));
}

export function isGatewayPermissionAllowed(user, permission) {
  if (!permission) return false;
  const role = user?.app_metadata?.role || user?.role;
  if (['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role)) return true;
  const permissions = Array.isArray(user?.permissions) ? user.permissions : (user?.app_metadata?.permissions || []);
  const revoked = Array.isArray(user?.revokedPermissions) ? user.revokedPermissions : (user?.app_metadata?.revokedPermissions || []);
  if (revoked.includes(permission)) return false;
  if (revoked.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)))) return false;
  return permissions.includes('*') || permissions.includes(permission) || permissions.includes(`${permission.split('.')[0]}.*`);
}