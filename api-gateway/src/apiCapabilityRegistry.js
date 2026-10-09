const CAPABILITIES = [
  ['GET', /^\/api\/orders\/[^/]+\/scan-prescription$/, 'prescription.read'],
  ['GET', /^\/api\/orders\/notifications\/logs$/, 'whatsapp.read'],
  ['GET', /^\/api\/orders\/[^/]+\/notify-whatsapp$/, 'whatsapp.manage'],
  ['POST', /^\/api\/orders\/[^/]+\/notify-whatsapp$/, 'whatsapp.manage'],
  ['POST', /^\/api\/orders\/[^/]+\/rating$/, 'orders.read'],
  ['PUT', /^\/api\/orders\/[^/]+\/review$/, 'prescription.review'],
  ['POST', /^\/api\/orders\/admin\/[^/]+\/prescription\/(?:reinitiate|manual-approve)$/, 'prescription.review'],
  ['PUT', /^\/api\/orders\/[^/]+\/dispatch$/, 'delivery.manage'],
  ['POST', /^\/api\/orders\/admin\/(?:optimize-and-club-routes|dispatch-batch)$/, 'delivery.manage'],
  ['POST', /^\/api\/orders\/?$/, 'orders.create'],
  ['GET', /^\/api\/orders\/admin(?:\/|$)/, 'orders.manage'],
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
  ['PUT', /^\/api\/admin\/medicine-requests\/[^/]+\/review(?:\/|$)/, 'medicine_requests.manage'],
  ['POST', /^\/api\/admin\/medicine-requests\/[^/]+\/reject-request(?:\/|$)/, 'medicine_requests.manage'],
  ['GET', /^\/api\/medicines\/admin\/inventory$/, 'inventory.read'],
  ['GET', /^\/api\/medicines\/alerts$/, 'inventory.read'],
  ['GET', /^\/api\/medicines\/audits$/, 'inventory.read'],
  ['GET', /^\/api\/medicines\/imports\/[^/]+\/(?:status|failed-records)$/, 'inventory.read'],
  ['POST', /^\/api\/medicines\/(?:imports|imports\/[^/]+\/retry|validate-import|confirm-import|upload-excel)$/, 'inventory.import'],
  ['POST', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['PUT', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['PATCH', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['DELETE', /^\/api\/medicines(?:\/|$)/, 'inventory.write'],
  ['POST', /^\/api\/coupons\/?$/, 'promotions.manage'],
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
  ['POST', /^\/api\/profile(?:\/|$)/, 'profile.write'],
  ['PUT', /^\/api\/profile(?:\/|$)/, 'profile.write'],
  ['DELETE', /^\/api\/profile(?:\/|$)/, 'profile.write'],
  ['GET', /^\/api\/profile(?:\/|$)/, 'profile.read'],
  ['PATCH', /^\/api\/profile(?:\/|$)/, 'profile.write'],
  ['POST', /^\/api\/riders\/?$/, 'delivery.manage'],
  ['GET', /^\/api\/riders(?:\/|$)/, 'delivery.read'],
  ['GET', /^\/api\/admin\/riders(?:\/|$)/, 'delivery.read'],
  ['POST', /^\/api\/admin\/riders(?:\/|$)/, 'delivery.manage'],
  ['PATCH', /^\/api\/admin\/riders(?:\/|$)/, 'delivery.manage'],
  ['GET', /^\/api\/admin\/assignment\/engine-status$/, 'delivery.read'],
  ['POST', /^\/api\/admin\/assignment(?:\/|$)/, 'delivery.manage'],
  ['PATCH', /^\/api\/admin\/assignment(?:\/|$)/, 'delivery.manage'],
  ['GET', /^\/api\/admin\/audit-logs(?:\/|$)/, 'users.read'],
  ['GET', /^\/api\/admin\/whatsapp\/(?:status|logs)(?:\/|$)/, 'whatsapp.read'],
  ['POST', /^\/api\/admin\/whatsapp\/(?:generate-qr|disconnect)(?:\/|$)/, 'whatsapp.manage'],
  ['GET', /^\/api\/v1\/auth\/me$/, 'profile.read'],
  ['POST', /^\/api\/v1\/auth\/logout$/, 'profile.write'],
  ['PUT', /^\/api\/v1\/auth\/(?:onboarding|complete-profile)$/, 'profile.complete'],
  ['POST', /^\/api\/v1\/auth\/mfa\/(?:enroll|confirm-enroll|mfa-disable)$/, 'profile.write'],
  ['GET', /^\/api\/v1\/profile\/access\/users(?:\/|$)/, 'users.read'],
  ['PATCH', /^\/api\/v1\/profile\/access\/users(?:\/|$)/, 'users.manage'],
  ['GET', /^\/api\/v1\/admin\/payments\/outstanding$/, 'billing.read'],
  ['POST', /^\/api\/v1\/admin\/payments\/reminders\/dispatch$/, 'billing.write'],
  ['GET', /^\/api\/v1\/billing(?:\/|$)/, 'billing.read'],
  ['POST', /^\/api\/v1\/billing(?:\/|$)/, 'billing.write'],
  ['PUT', /^\/api\/v1\/billing(?:\/|$)/, 'billing.write'],
  ['PATCH', /^\/api\/v1\/billing(?:\/|$)/, 'billing.write'],
  ['DELETE', /^\/api\/v1\/billing(?:\/|$)/, 'billing.write'],
  ['GET', /^\/api\/v1\/referrals(?:\/|$)/, 'referrals.read'],
  ['POST', /^\/api\/v1\/referrals(?:\/|$)/, 'referrals.manage'],
  ['PUT', /^\/api\/v1\/referrals(?:\/|$)/, 'referrals.manage'],
  ['PATCH', /^\/api\/v1\/referrals(?:\/|$)/, 'referrals.manage'],
  ['GET', /^\/api\/v1\/profile(?:\/|$)/, 'profile.read'],
  ['POST', /^\/api\/v1\/profile(?:\/|$)/, 'profile.write'],
  ['PUT', /^\/api\/v1\/profile(?:\/|$)/, 'profile.write'],
  ['PATCH', /^\/api\/v1\/profile(?:\/|$)/, 'profile.write'],
  ['GET', /^\/api\/v1\/admin\/tenants(?:\/|$)/, 'tenants.read'],
  ['POST', /^\/api\/v1\/admin\/tenants(?:\/|$)/, 'tenants.manage'],
  ['PUT', /^\/api\/v1\/admin\/tenants(?:\/|$)/, 'tenants.manage'],
  ['PATCH', /^\/api\/v1\/admin\/tenants(?:\/|$)/, 'tenants.manage'],
  ['DELETE', /^\/api\/v1\/admin\/tenants(?:\/|$)/, 'tenants.manage'],
  ['GET', /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/, 'tenants.read'],
  ['POST', /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/, 'tenants.manage'],
  ['PUT', /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/, 'tenants.manage'],
  ['PATCH', /^\/api\/v1\/(?:tenants|branches)(?:\/|$)/, 'tenants.manage'],
  ['GET', /^\/api\/v1\/customers(?:\/|$)/, 'profile.read'],
  ['POST', /^\/api\/v1\/customers(?:\/|$)/, 'profile.write'],
  ['PATCH', /^\/api\/v1\/customers(?:\/|$)/, 'profile.write'],
  ['POST', /^\/api\/v1\/inventory\/adjust$/, 'inventory.write'],
  ['POST', /^\/api\/v1\/prescriptions\/[^/]+\/review(?:\/(?:claim|approve|reject|wait))?$/, 'prescription.review'],
  ['POST', /^\/api\/v1\/prescriptions\/hospitals$/, 'prescription.write'],
  ['POST', /^\/api\/v1\/prescriptions\/[^/]+\/(?:link-order|convert-to-order|remove)$/, 'prescription.write'],
  ['GET', /^\/api\/v1\/prescriptions\/reviews\/queue$/, 'prescription.review'],
  ['GET', /^\/api\/v1\/orders\/[^/]+\/events$/, 'orders.manage'],
  ['PATCH', /^\/api\/v1\/orders\/[^/]+\/status$/, 'orders.manage'],
  ['GET', /^\/api\/v1\/orders(?:\/|$)/, 'orders.read'],
  ['POST', /^\/api\/v1\/orders\/?$/, 'orders.create'],
  ['GET', /^\/api\/v1\/catalog(?:\/|$)/, 'inventory.read'],
  ['GET', /^\/api\/v1\/pricing(?:\/|$)/, 'orders.read'],
  ['GET', /^\/api\/v1\/delivery(?:\/|$)/, 'delivery.read'],
  ['POST', /^\/api\/v1\/delivery(?:\/|$)/, 'delivery.manage'],
  ['PATCH', /^\/api\/v1\/delivery(?:\/|$)/, 'delivery.manage'],
  ['GET', /^\/api\/v1\/medicine-requests(?:\/|$)/, 'medicine_requests.read'],
  ['POST', /^\/api\/v1\/medicine-requests(?:\/|$)/, 'medicine_requests.create'],
  ['POST', /^\/api\/v1\/integrations\/sync(?:\/|$)/, 'csquare.sync'],
  ['GET', /^\/api\/v1\/integrations(?:\/|$)/, 'csquare.read'],
  ['PUT', /^\/api\/v1\/integrations(?:\/|$)/, 'csquare.manage'],
  ['POST', /^\/api\/v1\/integrations(?:\/|$)/, 'csquare.manage'],
  ['GET', /^\/api\/v1\/notifications(?:\/|$)/, 'profile.read'],
  ['POST', /^\/api\/v1\/notifications(?:\/|$)/, 'profile.write'],
  ['GET', /^\/api\/v1\/vendors?(?:\/|$)/, 'tenants.read'],
  ['POST', /^\/api\/v1\/vendors?(?:\/|$)/, 'tenants.manage']
];

const PUBLIC_PATHS = [
  ['POST', /^\/api\/v1\/auth\/(?:signup|activate|verify-email|login|google|resend-verification|refresh|password\/forgot|password\/reset|mfa\/verify)$/],
  ['GET', /^\/api\/v1\/auth\/csrf$/],
  ['GET', /^\/api\/v1\/health(?:\/|$)/],
  // Public storefront catalog. Backend exposes GET /api/medicines as a
  // deliberately unauthenticated, sanitized catalog endpoint. Keep admin
  // inventory (/admin/inventory) and all mutations protected by capabilities.
  ['GET', /^\/api\/medicines$/],
  ['GET', /^\/api\/medicines\/discovery$/],
  ['GET', /^\/api\/public\//], ['POST', /^\/api\/public\//],
  ['GET', /^\/api\/vendors\//], ['POST', /^\/api\/vendors\//],
  ['GET', /^\/api\/vendor\//], ['POST', /^\/api\/vendor\//]
];

export function resolveGatewayCapability(method, url) {
  const path = String(url || '').split('?')[0];
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (PUBLIC_PATHS.some(([m, pattern]) => m === normalizedMethod && pattern.test(path))) return null;
  return CAPABILITIES.find(([m, pattern]) => m === normalizedMethod && pattern.test(path))?.[2] || null;
}

export function isGatewayPublicPath(method, url) {
  const path = String(url || '').split('?')[0];
  const normalizedMethod = String(method || 'GET').toUpperCase();
  return PUBLIC_PATHS.some(([m, pattern]) => m === normalizedMethod && pattern.test(path));
}

export function isGatewayPermissionAllowed(user, permission) {
  if (!permission) return false;
  const permissions = Array.isArray(user?.permissions) ? user.permissions : (user?.app_metadata?.permissions || []);
  const revoked = Array.isArray(user?.revokedPermissions)
    ? user.revokedPermissions
    : (Array.isArray(user?.app_metadata?.revokedPermissions) ? user.app_metadata.revokedPermissions : []);
  // Deny rules must win even when a platform-admin role or wildcard grant exists.
  if (revoked.includes(permission)) return false;
  if (revoked.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)))) return false;

  const role = user?.app_metadata?.role || user?.role;
  if (['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role)) return true;
  return permissions.includes('*')
    || permissions.includes(permission)
    || permissions.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)));
}