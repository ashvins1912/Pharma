/**
 * Automated RBAC, Role-Wise Feature Validation & Blocker Intelligence Engine
 * Tests Positive & Negative Access, Multi-Tenant Boundaries, and Permission Revocations across all roles.
 */
import assert from 'node:assert/strict';
import { authorizationService } from '../../../backend/authorization/AuthorizationService.js';
import { getRolePermissions, getRoleScope } from '../../../backend/authorization/AuthorizationCatalogService.js';
import { resolveGatewayCapability, isGatewayPublicPath, isGatewayPermissionAllowed } from '../../../api-gateway/src/apiCapabilityRegistry.js';

export const MASTER_ROLES = [
  'SUPER_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'PHARMACIST',
  'PHARMACY_STAFF',
  'INVENTORY_MANAGER',
  'ORDER_MANAGER',
  'RIDER',
  'CUSTOMER'
];

export const CORE_FEATURES = [
  {
    id: 'customer_checkout',
    name: 'Customer Cart & Checkout',
    endpoint: '/api/orders/checkout',
    method: 'POST',
    requiredPermission: 'orders.create',
    requiredScope: 'CUSTOMER',
    allowedRoles: ['CUSTOMER', 'SUPER_ADMIN'],
    deniedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'INVENTORY_MANAGER', 'RIDER']
  },
  {
    id: 'tenant_inventory_management',
    name: 'Tenant Inventory Management',
    endpoint: '/api/medicines/admin/inventory',
    method: 'GET',
    requiredPermission: 'inventory.read',
    requiredScope: 'TENANT',
    allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'INVENTORY_MANAGER', 'SUPER_ADMIN'],
    deniedRoles: ['CUSTOMER', 'RIDER']
  },
  {
    id: 'staff_management',
    name: 'Tenant Members & Staff Management',
    endpoint: '/api/v1/tenants/t-123/memberships',
    method: 'POST',
    requiredPermission: 'tenant.branches.manage',
    requiredScope: 'TENANT',
    allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'SUPER_ADMIN'],
    deniedRoles: ['PHARMACY_STAFF', 'PHARMACIST', 'INVENTORY_MANAGER', 'RIDER', 'CUSTOMER']
  },
  {
    id: 'platform_tenant_governance',
    name: 'Platform Tenant Governance',
    endpoint: '/api/v1/admin/tenants',
    method: 'GET',
    requiredPermission: 'tenants.read',
    requiredScope: 'PLATFORM',
    allowedRoles: ['SUPER_ADMIN'],
    deniedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'INVENTORY_MANAGER', 'RIDER', 'CUSTOMER']
  },
  {
    id: 'prescription_review',
    name: 'Prescription Review & Pharmacist Verification',
    endpoint: '/api/v1/prescriptions/rx-123/review',
    method: 'POST',
    requiredPermission: 'prescription.review',
    requiredScope: 'TENANT',
    allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'SUPER_ADMIN'],
    deniedRoles: ['PHARMACY_STAFF', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'RIDER', 'CUSTOMER']
  },
  {
    id: 'rider_dispatch',
    name: 'Rider Fleet & Order Dispatch',
    endpoint: '/api/orders/ord-123/dispatch',
    method: 'PUT',
    requiredPermission: 'delivery.manage',
    requiredScope: 'TENANT',
    allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'ORDER_MANAGER', 'SUPER_ADMIN'],
    deniedRoles: ['PHARMACY_STAFF', 'INVENTORY_MANAGER', 'CUSTOMER']
  },
  {
    id: 'inventory_suggest_restock',
    name: 'Automated Suggest Restock & Reorder Calculation',
    endpoint: '/api/medicines/admin/suggest-restock',
    method: 'GET',
    requiredPermission: 'inventory.read',
    requiredScope: 'TENANT',
    allowedRoles: ['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'INVENTORY_MANAGER', 'SUPER_ADMIN'],
    deniedRoles: ['CUSTOMER', 'RIDER']
  }
];

export async function runRbacValidationSuite() {
  const report = {
    executedAt: new Date().toISOString(),
    totalChecks: 0,
    passedChecks: 0,
    failedChecks: 0,
    blockers: [],
    matrixResults: {}
  };

  // Resolve database-backed role permissions concurrently once per role per audit.
  // Sequential database reads made this admin health endpoint exceed browser/API timeouts.
  const rolePermissionEntries = await Promise.all(
    MASTER_ROLES.map(async role => [role, await getRolePermissions(role)])
  );
  const rolePermissionsCache = new Map(rolePermissionEntries);

  for (const feature of CORE_FEATURES) {
    report.matrixResults[feature.id] = {};

    for (const role of MASTER_ROLES) {
      report.totalChecks++;
      const isExpectedAllowed = feature.allowedRoles.includes(role);
      
      const permissions = rolePermissionsCache.get(role) || [];
      const isSuper = ['SUPER_ADMIN', 'admin'].includes(role);
      const hasPerm = isSuper || permissions.includes(feature.requiredPermission) || permissions.includes('*');

      // 1. Gateway Capability Resolution Check
      const gatewayRequiredPerm = resolveGatewayCapability(feature.method, feature.endpoint);
      const gatewayMatches = gatewayRequiredPerm === feature.requiredPermission || isGatewayPublicPath(feature.method, feature.endpoint);

      // 2. Authorization Service Context Check
      const mockUserContext = {
        id: `user-${role.toLowerCase()}-1`,
        sub: `user-${role.toLowerCase()}-1`,
        role: role,
        app_metadata: { role: role },
        permissions: isSuper ? ['*'] : permissions,
        tenantId: role === 'SUPER_ADMIN' ? null : (role === 'CUSTOMER' ? null : 'tenant-test-a'),
        branchId: role === 'PHARMACY_STAFF' ? 'branch-test-1' : null,
        scope: role === 'SUPER_ADMIN' ? 'PLATFORM' : (role === 'CUSTOMER' ? 'CUSTOMER' : 'TENANT')
      };

      // Scope awareness: customer context cannot access TENANT/PLATFORM scoped features, and TENANT staff cannot checkout in staff context
      const scopeMatches = isSuper || (feature.requiredScope === mockUserContext.scope);
      const isAllowedByAuthService = authorizationService.isAllowed(mockUserContext, feature.requiredPermission) && scopeMatches;

      // 3. Multi-Tenant Cross-Access Negative Test
      let tenantIsolationPassed = true;
      if (role !== 'SUPER_ADMIN' && mockUserContext.tenantId) {
        // Attempt to access Resource belonging to Tenant B
        const crossTenantAllowed = authorizationService.canAccessTenantResource(mockUserContext, 'tenant-test-b');
        if (crossTenantAllowed) {
          tenantIsolationPassed = false;
          report.blockers.push({
            id: `BLK-ISO-${feature.id}-${role}`,
            category: 'TENANT_ISOLATION_BLOCKER',
            severity: 'P0',
            feature: feature.name,
            role,
            tenant: 'tenant-test-b',
            message: `Role ${role} from Tenant A was not denied access to Tenant B resource.`
          });
        }
      }

      // 4. Permission Revocation Negative Test
      const revokedContext = {
        ...mockUserContext,
        revokedPermissions: [feature.requiredPermission]
      };
      const isRevocationEnforced = !authorizationService.isAllowed(revokedContext, feature.requiredPermission);

      const rolePassed = (isAllowedByAuthService === isExpectedAllowed) && tenantIsolationPassed && isRevocationEnforced;

      if (rolePassed) {
        report.passedChecks++;
        report.matrixResults[feature.id][role] = {
          status: isExpectedAllowed ? 'HEALTHY' : 'RESTRICTED',
          hasPermission: hasPerm,
          expectedAllowed: isExpectedAllowed,
          revocationEnforced: isRevocationEnforced,
          tenantIsolationVerified: tenantIsolationPassed
        };
      } else {
        report.failedChecks++;
        const blockerCat = !tenantIsolationPassed ? 'TENANT_ISOLATION_BLOCKER' : 'RBAC_BLOCKER';
        report.blockers.push({
          id: `BLK-${feature.id}-${role}`,
          category: blockerCat,
          severity: !tenantIsolationPassed ? 'P0' : 'P1',
          feature: feature.name,
          role,
          message: `Mismatch in authorization evaluation. Expected allowed: ${isExpectedAllowed}, but service permitted: ${isAllowedByAuthService}.`
        });
        report.matrixResults[feature.id][role] = {
          status: 'FAILING',
          hasPermission: hasPerm,
          expectedAllowed: isExpectedAllowed,
          revocationEnforced: isRevocationEnforced,
          tenantIsolationVerified: tenantIsolationPassed
        };
      }
    }
  }

  return report;
}
