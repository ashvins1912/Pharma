/**
 * Centralized RequestContext & Multi-Tenant Authorization Middleware
 */
import crypto from 'node:crypto';
import {
    TenantAccessDeniedError,
    BranchAccessDeniedError
} from '../shared/errors/DomainErrors.js';
import { PlatformRoles, TenantRoles, CustomerRole, isPlatformSuperAdmin } from '../shared/contracts/index.js';

// In-memory membership registry (backed by TenantMembership collection)
export const tenantMembershipsStore = new Map();
// Key: `${userId}:${tenantId}` -> TenantMembership

export const registerMembership = (membership) => {
    const key = `${membership.userId}:${membership.tenantId}`;
    tenantMembershipsStore.set(key, membership);
};

export const getMembership = (userId, tenantId) => {
    return tenantMembershipsStore.get(`${userId}:${tenantId}`) || null;
};

export const resolveUserContext = (req) => {
    if (!req.context) {
        req.context = {
            requestId: req.headers['x-request-id'] || `req-${crypto.randomUUID().slice(0, 8)}`,
            userId: null,
            customerId: null,
            tenantId: null,
            branchId: null,
            isPlatformUser: false,
            platformRole: null,
            tenantMembership: null,
            role: CustomerRole,
            scope: 'CUSTOMER',
            permissions: [],
            tenantMismatch: false
        };
    }

    const context = req.context;
    const headerTenantId = req.headers['x-tenant-id'] || req.query?.tenantId || req.body?.tenantId || req.params?.tenantId || null;
    const headerBranchId = req.headers['x-branch-id'] || req.query?.branchId || req.body?.branchId || req.params?.branchId || null;

    if (headerTenantId && !context.tenantId) context.tenantId = String(headerTenantId).trim();
    if (headerBranchId && !context.branchId) context.branchId = String(headerBranchId).trim();

    if (req.user) {
        context.userId = req.user.sub || req.user.id || null;
        context.customerId = req.user.customerId || context.userId;

        const rawRole = req.user.app_metadata?.role || req.user.role || '';
        const tenantIdFromMetadata = req.user.app_metadata?.tenantId !== undefined
            ? req.user.app_metadata.tenantId
            : (req.user.tenantId || null);

        if (isPlatformSuperAdmin(rawRole)) {
            context.isPlatformUser = true;
            context.platformRole = 'SUPER_ADMIN';
            context.role = 'SUPER_ADMIN';
            context.scope = 'PLATFORM';
            context.tenantId = headerTenantId ? String(headerTenantId).trim() : null;
        } else if (rawRole === 'TENANT_ADMIN' || rawRole === 'TENANT_OWNER') {
            context.role = 'TENANT_ADMIN';
            context.scope = 'TENANT';
            const boundTenant = tenantIdFromMetadata || (context.userId
                ? Array.from(tenantMembershipsStore.values()).find(m => m.userId === context.userId)?.tenantId
                : null);
            context.authorizedTenantId = boundTenant || null;
            const targetTenant = headerTenantId ? String(headerTenantId).trim() : (context.tenantId || null);
            if (targetTenant) {
                if (boundTenant && boundTenant !== targetTenant) {
                    context.tenantMismatch = true;
                }
                context.tenantId = targetTenant;
            } else {
                context.tenantId = boundTenant || null;
            }
        } else if (rawRole === 'PHARMACY_STAFF' || Object.values(TenantRoles).includes(rawRole)) {
            context.role = rawRole;
            context.scope = 'TENANT';
            const boundTenant = tenantIdFromMetadata || (context.userId
                ? Array.from(tenantMembershipsStore.values()).find(m => m.userId === context.userId)?.tenantId
                : null);
            context.authorizedTenantId = boundTenant || null;
            const targetTenant = headerTenantId ? String(headerTenantId).trim() : (context.tenantId || null);
            if (targetTenant) {
                if (boundTenant && boundTenant !== targetTenant) {
                    context.tenantMismatch = true;
                }
                context.tenantId = targetTenant;
            } else {
                context.tenantId = boundTenant || null;
            }
        } else if (rawRole === 'RIDER' || rawRole === 'TENANT_RIDER') {
            context.role = 'RIDER';
            context.scope = 'TENANT';
            context.authorizedTenantId = tenantIdFromMetadata || null;
            context.tenantId = headerTenantId ? String(headerTenantId).trim() : (tenantIdFromMetadata || null);
        } else {
            context.role = CustomerRole;
            context.scope = 'CUSTOMER';
            if (headerTenantId) context.tenantId = String(headerTenantId).trim();
        }

        // Check active membership
        if (context.tenantId && !context.isPlatformUser) {
            const membership = getMembership(context.userId, context.tenantId);
            if (membership && (membership.status === 'ACTIVE' || membership.status === 'INVITED')) {
                context.tenantMembership = membership;
                context.role = membership.role;
                context.permissions = membership.permissions || [];
                if (membership.branchId) {
                    context.branchId = membership.branchId;
                }
            }
        }
    }
};

export const contextMiddleware = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || `req-${crypto.randomUUID().slice(0, 8)}`;
    res.setHeader('x-request-id', requestId);
    resolveUserContext(req);
    next();
};

export const requireTenantScope = (req, res, next) => {
    resolveUserContext(req);

    // Cross-tenant denial guard
    if (req.context?.tenantMismatch || (
        req.context?.authorizedTenantId &&
        req.context?.tenantId &&
        req.context.authorizedTenantId !== req.context.tenantId &&
        !req.context?.isPlatformUser
    )) {
        const err = new TenantAccessDeniedError('Cross-tenant access forbidden. You cannot access data outside your assigned tenant.');
        return res.status(err.status).json(err.toJSON(req.context?.requestId));
    }

    if (!req.context?.tenantId) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'TENANT_REQUIRED',
                message: 'Target pharmacy tenant must be specified via x-tenant-id header.',
                requestId: req.context?.requestId
            }
        });
    }

    // Platform users have cross-tenant access
    if (req.context.isPlatformUser) return next();

    // If staff access is required, verify tenant membership
    if (req.context.tenantMembership) return next();

    // For customers visiting a storefront, tenantId can be set without staff membership
    if (req.context.role === CustomerRole) return next();

    const err = new TenantAccessDeniedError('You do not hold active staff membership for this tenant.');
    return res.status(err.status).json(err.toJSON(req.context?.requestId));
};

export const requireBranchScope = (req, res, next) => {
    resolveUserContext(req);

    if (!req.context?.branchId) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'BRANCH_REQUIRED',
                message: 'Target pharmacy branch must be specified via x-branch-id header or branchId parameter.',
                requestId: req.context?.requestId
            }
        });
    }

    // If staff membership is restricted to a specific branch, enforce branch match
    if (
        req.context.tenantMembership?.branchId &&
        req.context.tenantMembership.branchId !== req.context.branchId &&
        !req.context.isPlatformUser
    ) {
        const err = new BranchAccessDeniedError('Your staff membership is restricted to a different branch.');
        return res.status(err.status).json(err.toJSON(req.context?.requestId));
    }

    return next();
};

export const requireTenantStaff = (req, res, next) => {
    resolveUserContext(req);
    if (req.context?.isPlatformUser) return next();
    if (req.context?.tenantMembership && Object.values(TenantRoles).includes(req.context.tenantMembership.role)) {
        return next();
    }
    const err = new TenantAccessDeniedError('Pharmacy staff privileges required.');
    return res.status(err.status).json(err.toJSON(req.context?.requestId));
};

export const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {
        resolveUserContext(req);

        // Enforce cross-tenant isolation before role check
        if (req.context?.tenantMismatch || (
            req.context?.authorizedTenantId &&
            req.context?.tenantId &&
            req.context.authorizedTenantId !== req.context.tenantId &&
            !req.context?.isPlatformUser
        )) {
            const err = new TenantAccessDeniedError('Cross-tenant access forbidden. You cannot access data outside your assigned tenant.');
            return res.status(err.status).json(err.toJSON(req.context?.requestId));
        }

        const userRole = req.context?.role || req.user?.app_metadata?.role || req.user?.role;
        const normalizedRole = isPlatformSuperAdmin(userRole) ? 'SUPER_ADMIN' : userRole;
        const normalizedAllowed = allowedRoles.map(r => isPlatformSuperAdmin(r) ? 'SUPER_ADMIN' : r);

        // Platform Super Admin has access if SUPER_ADMIN is among allowed or if isPlatformUser
        if ((normalizedRole === 'SUPER_ADMIN' || req.context?.isPlatformUser) &&
            (normalizedAllowed.includes('SUPER_ADMIN') || normalizedAllowed.includes(PlatformRoles.PLATFORM_SUPER_ADMIN))) {
            return next();
        }

        if (normalizedAllowed.includes(normalizedRole)) return next();

        return res.status(403).json({
            success: false,
            error: {
                code: 'FORBIDDEN',
                message: `Action requires one of the following roles: ${allowedRoles.join(', ')}`,
                requestId: req.context?.requestId
            }
        });
    };
};

export const requireSuperAdmin = (req, res, next) => {
    resolveUserContext(req);
    const role = req.context?.role || req.user?.app_metadata?.role || req.user?.role;
    if (isPlatformSuperAdmin(role) || req.context?.isPlatformUser) {
        return next();
    }
    return res.status(403).json({
        success: false,
        error: {
            code: 'FORBIDDEN',
            message: 'Action requires Platform Super Administrator privileges.',
            requestId: req.context?.requestId
        }
    });
};

export default {
    resolveUserContext,
    contextMiddleware,
    requireTenantScope,
    requireBranchScope,
    requireTenantStaff,
    requireRoles,
    requireSuperAdmin,
    registerMembership,
    getMembership
};
