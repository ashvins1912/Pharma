import { tenantService } from '../services/tenant-service/TenantService.js';
import { isPlatformSuperAdmin } from '../shared/contracts/index.js';
import { getRolePermissions, getRoleScope } from './AuthorizationCatalogService.js';
import UserProfile from '../models/UserProfile.js';

function hasPermission(granted, required, revoked = []) {
  if (!required) return true;
  if (revoked.includes(required) || revoked.some(item => item.endsWith('.*') && required.startsWith(item.slice(0, -1)))) return false;
  return granted.includes('*') || granted.includes(required) || granted.some(item => item.endsWith('.*') && required.startsWith(item.slice(0, -1)));
}

export class AuthorizationService {
  async resolve(user) {
    const userId = user?.sub || user?.id || user?.userId;
    if (!userId) throw new Error('Authorization subject is required.');

    const tokenType = user?.tokenType;
    if (tokenType === 'ONBOARDING' || tokenType === 'pharma_onboarding' || tokenType === 'MFA_CHALLENGE' || tokenType === 'pharma_mfa_challenge') {
      return {
        sub: userId,
        role: tokenType.toUpperCase(),
        roles: [tokenType.toUpperCase()],
        tenantId: null,
        branchId: null,
        scope: tokenType.includes('MFA') ? 'MFA' : 'ONBOARDING',
        permissions: Array.isArray(user?.permissions) ? [...new Set(user.permissions)] : [],
        permissionVersion: Number(user?.permissionVersion || 1),
        membershipId: null
      };
    }

    let requestedTenantId = user?.tenantId || user?.app_metadata?.tenantId || null;
    let branchId = user?.branchId || null;
    let membership = null;

    // TenantMembership is the authoritative source for tenant-scoped users.
    const memberships = await tenantService.getMembershipsForUser(userId);
    if (requestedTenantId) {
      membership = memberships.find(item =>
        String(item.tenantId) === String(requestedTenantId) &&
        (!branchId || !item.branchId || String(item.branchId) === String(branchId))
      );
      if (!membership) {
        const err = new Error('Active tenant membership is required.');
        err.code = 'TENANT_ACCESS_DENIED';
        err.status = 403;
        throw err;
      }
      if (membership.status !== 'ACTIVE') {
        const err = new Error('Tenant membership is not active.');
        err.code = 'TENANT_ACCESS_DENIED';
        err.status = 403;
        throw err;
      }
      requestedTenantId = String(membership.tenantId);
      branchId = branchId || membership.branchId || null;
    }

    const rawRole = membership?.role || user?.role || user?.app_metadata?.role || user?.roles?.[0] || 'customer';
    const role = isPlatformSuperAdmin(rawRole) ? 'SUPER_ADMIN' : rawRole;
    if (getRoleScope(role) === 'TENANT' && !membership) {
      const err = new Error('Active tenant membership is required.');
      err.code = 'TENANT_ACCESS_DENIED';
      err.status = 403;
      throw err;
    }
    const rolePermissions = await getRolePermissions(role);
    const permissions = new Set(rolePermissions);
    const revokedPermissions = new Set();

    // Membership permissions are explicit tenant-level grants/overrides.
    for (const permission of membership?.permissions || []) permissions.add(permission);
    // Platform/customer explicit permission overrides may be supplied by the user record.
    if (!membership) for (const permission of user?.permissions || []) permissions.add(permission);

    let userProfile = null;
    try {
      userProfile = await UserProfile.findOne({ $or: [{ supabase_user_id: userId }, { supabaseId: userId }, { userId }] }).select('permissions accessGrants accessRevokes permissionVersion').lean();
    } catch { userProfile = null; }
    for (const permission of userProfile?.permissions || []) permissions.add(permission);
    for (const permission of userProfile?.accessGrants || []) permissions.add(permission);
    for (const permission of userProfile?.accessRevokes || []) { permissions.delete(permission); revokedPermissions.add(permission); }
    if (role === 'SUPER_ADMIN') { permissions.clear(); permissions.add('*'); }

    return {
      sub: userId,
      role,
      roles: membership?.role ? [membership.role] : (Array.isArray(user?.roles) ? user.roles : [role]),
      tenantId: role === 'SUPER_ADMIN' ? null : requestedTenantId,
      branchId: role === 'SUPER_ADMIN' ? null : branchId,
      scope: role === 'SUPER_ADMIN' ? 'PLATFORM' : (requestedTenantId ? 'TENANT' : getRoleScope(role)),
      permissions: [...permissions],
      revokedPermissions: [...revokedPermissions],
      permissionVersion: Number(userProfile?.permissionVersion || user?.permissionVersion || user?.permissionsVersion || user?.version || 1),
      membershipId: membership?.id || membership?._id?.toString() || null
    };
  }

  isAllowed(context, permission) {
    return hasPermission(context?.permissions || [], permission, context?.revokedPermissions || []);
  }
}

export const authorizationService = new AuthorizationService();
