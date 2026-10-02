/**
 * Centralized RequestContext & Multi-Tenant Authorization Middleware
 */
import crypto from 'node:crypto';
import {
    TenantAccessDeniedError,
    BranchAccessDeniedError,
    CustomerAccessDeniedError
} from '../shared/errors/DomainErrors.js';
import { PlatformRoles, TenantRoles, CustomerRole } from '../shared/contracts/index.js';

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

export const contextMiddleware = (req, res, next) => {
    const requestId = req.headers['x-request-id'] || `req-${crypto.randomUUID().slice(0, 8)}`;
    res.setHeader('x-request-id', requestId);

    // Initial RequestContext
    const context = {
        requestId,
        userId: req.user?.sub || req.user?.id || null,
        customerId: req.user?.customerId || req.user?.sub || null,
        tenantId: null,
        branchId: null,
        isPlatformUser: false,
        platformRole: null,
        tenantMembership: null,
        role: CustomerRole,
        permissions: []
    };

    if (req.user) {
        const userRole = req.user.app_metadata?.role || req.user.role || '';
        if (
            userRole === 'admin' ||
            userRole === 'PLATFORM_SUPER_ADMIN' ||
            Object.values(PlatformRoles).includes(userRole)
        ) {
            context.isPlatformUser = true;
            context.platformRole = userRole === 'admin' ? PlatformRoles.PLATFORM_SUPER_ADMIN : userRole;
            context.role = context.platformRole;
        }

        // Requested Tenant and Branch from headers or query
        const headerTenantId = req.headers['x-tenant-id'] || req.query.tenantId || req.body?.tenantId || null;
        const headerBranchId = req.headers['x-branch-id'] || req.query.branchId || req.body?.branchId || null;

        if (headerTenantId) {
            context.tenantId = String(headerTenantId).trim();
            // Verify tenant membership if not platform super admin
            if (context.isPlatformUser) {
                context.branchId = headerBranchId ? String(headerBranchId).trim() : null;
            } else {
                const membership = getMembership(context.userId, context.tenantId);
                if (membership && membership.status === 'ACTIVE') {
                    context.tenantMembership = membership;
                    context.role = membership.role;
                    context.permissions = membership.permissions || [];
                    // Branch isolation check
                    if (membership.branchId) {
                        context.branchId = membership.branchId;
                    } else if (headerBranchId) {
                        context.branchId = String(headerBranchId).trim();
                    }
                } else if (userRole === 'customer' || !userRole) {
                    // Customer querying a tenant's public catalog/branch
                    context.role = CustomerRole;
                    context.branchId = headerBranchId ? String(headerBranchId).trim() : null;
                }
            }
        } else if (headerBranchId) {
            context.branchId = String(headerBranchId).trim();
        }
    }

    req.context = context;
    next();
};

export const requireTenantScope = (req, res, next) => {
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
    if (req.context?.isPlatformUser) return next();
    if (req.context?.tenantMembership && Object.values(TenantRoles).includes(req.context.tenantMembership.role)) {
        return next();
    }
    const err = new TenantAccessDeniedError('Pharmacy staff privileges required.');
    return res.status(err.status).json(err.toJSON(req.context?.requestId));
};

export const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (req.context?.isPlatformUser) return next();
        const userRole = req.context?.role || req.user?.app_metadata?.role;
        if (allowedRoles.includes(userRole)) return next();

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

export default {
    contextMiddleware,
    requireTenantScope,
    requireBranchScope,
    requireTenantStaff,
    requireRoles,
    registerMembership,
    getMembership
};
