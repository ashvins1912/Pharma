import { tenantService } from '../services/tenant-service/TenantService.js';
import { isPlatformSuperAdmin } from '../shared/contracts/index.js';
import { getRolePermissions, getRoleScope } from './AuthorizationCatalogService.js';
import UserProfile from '../models/UserProfile.js';
import mongoose from 'mongoose';
import { isPermissionGranted } from '@pharma/service-kernel';



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
    const membershipRole = String(membership?.role || '').toUpperCase();
    const hasStaffPermissionCeiling = Boolean(membership
      && Array.isArray(membership.permissions)
      && !['TENANT_OWNER', 'TENANT_ADMIN'].includes(membershipRole));
    // A branch-staff membership is an explicit permission ceiling, not an
    // additive grant on top of the broader role catalog.
    const permissions = new Set(hasStaffPermissionCeiling ? membership.permissions : rolePermissions);
    const revokedPermissions = new Set([
      ...(Array.isArray(user?.revokedPermissions) ? user.revokedPermissions : []),
      ...(Array.isArray(user?.app_metadata?.revokedPermissions) ? user.app_metadata.revokedPermissions : [])
    ]);
    if (!hasStaffPermissionCeiling) {
      for (const permission of membership?.permissions || []) permissions.add(permission);
    }
    if (!membership) for (const permission of user?.permissions || []) permissions.add(permission);

    let userProfile = null;
    if (mongoose.connection?.readyState === 1) {
      try {
        userProfile = await UserProfile.findOne({ $or: [{ supabase_user_id: userId }, { supabaseId: userId }, { userId }] }).select('permissions accessGrants accessRevokes permissionVersion').lean();
      } catch {}
    }
    for (const permission of userProfile?.permissions || []) {
      if (!hasStaffPermissionCeiling || permissions.has(permission)) permissions.add(permission);
    }
    for (const permission of userProfile?.accessGrants || []) {
      if (!hasStaffPermissionCeiling || permissions.has(permission)) permissions.add(permission);
    }
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

  isPlatformContext(context) {
    const role = String(context?.role || context?.app_metadata?.role || '').toUpperCase();
    return context?.scope === 'PLATFORM' || ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'ADMIN'].includes(role);
  }

  canAccessTenantResource(context, tenantId, branchId = null) {
    if (!context || !tenantId) return false;
    if (this.isPlatformContext(context)) return true;
    if (!context.tenantId || String(context.tenantId) !== String(tenantId)) return false;
    if (context.branchId && branchId && String(context.branchId) !== String(branchId)) return false;
    if (context.branchId && !branchId) return false;
    return true;
  }

  isAllowed(context, permission) {
    const revoked = context?.revokedPermissions || context?.app_metadata?.revokedPermissions || [];
    if (permission && (
      revoked.includes(permission)
      || revoked.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)))
    )) return false;
    const role = context?.role || context?.app_metadata?.role;
    if (role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN' || role === 'admin') return true;
    return isPermissionGranted({ subject: context, permission });
  }
}

export const authorizationService = new AuthorizationService();
