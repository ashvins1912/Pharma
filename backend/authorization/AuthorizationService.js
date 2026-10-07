import { tenantService } from '../services/tenant-service/TenantService.js';
import { isPlatformSuperAdmin } from '../shared/contracts/index.js';

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ['*'],
  PLATFORM_SUPER_ADMIN: ['*'],
  admin: ['*'],
  TENANT_OWNER: ['*'],
  TENANT_ADMIN: ['*'],
  PHARMACIST: [
    'inventory.read','inventory.write','inventory.import',
    'orders.read','orders.create','orders.manage',
    'prescription.read','prescription.write','prescription.review'
  ],
  PHARMACY_STAFF: [
    'inventory.read','orders.read','orders.create',
    'prescription.read','prescription.write'
  ],
  INVENTORY_MANAGER: ['inventory.read','inventory.write','inventory.import'],
  ORDER_MANAGER: ['orders.read','orders.create','orders.manage'],
  CUSTOMER: ['orders.read','orders.create','prescription.read','prescription.write'],
  customer: ['orders.read','orders.create','prescription.read','prescription.write']
};

function hasPermission(granted, required) {
  if (!required) return true;
  return granted.includes('*') || granted.includes(required);
}

export class AuthorizationService {
  async resolve(user) {
    const userId = user?.sub || user?.id || user?.userId;
    if (!userId) throw new Error('Authorization subject is required.');

    const rawRole = user?.role || user?.app_metadata?.role || user?.roles?.[0] || 'customer';
    const role = isPlatformSuperAdmin(rawRole) ? 'SUPER_ADMIN' : rawRole;
    let tenantId = user?.tenantId || user?.app_metadata?.tenantId || null;
    let branchId = user?.branchId || null;
    let permissions = new Set([
      ...(Array.isArray(user?.permissions) ? user.permissions : []),
      ...(Array.isArray(user?.app_metadata?.permissions) ? user.app_metadata.permissions : []),
      ...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.customer)
    ]);

    let membership = null;
    if (tenantId) {
      const memberships = await tenantService.getMembershipsForUser(userId);
      membership = memberships.find(item =>
        String(item.tenantId) === String(tenantId) &&
        (!branchId || !item.branchId || String(item.branchId) === String(branchId))
      );
      if (membership?.status && membership.status !== 'ACTIVE') {
        throw Object.assign(new Error('Tenant membership is not active.'), { code: 'TENANT_ACCESS_DENIED', status: 403 });
      }
      if (membership) {
        branchId = branchId || membership.branchId || null;
        for (const permission of membership.permissions || []) permissions.add(permission);
      }
    }

    return {
      sub: userId,
      role,
      roles: Array.isArray(user?.roles) ? user.roles : [role],
      tenantId: role === 'SUPER_ADMIN' ? null : tenantId,
      branchId,
      scope: role === 'SUPER_ADMIN' ? 'PLATFORM' : (tenantId ? 'TENANT' : 'CUSTOMER'),
      permissions: [...permissions],
      permissionVersion: Number(user?.permissionVersion || user?.permissionsVersion || user?.version || 1),
      membershipId: membership?.id || membership?._id?.toString() || null
    };
  }

  isAllowed(context, permission) {
    return hasPermission(context?.permissions || [], permission);
  }
}

export const authorizationService = new AuthorizationService();
export { ROLE_PERMISSIONS };
