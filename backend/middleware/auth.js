import 'dotenv/config';
import { verifyPharmaAccessToken } from '../security/pharmaToken.js';
import { authorizationService } from '../authorization/AuthorizationService.js';
import { resolveApiCapability } from '../authorization/ApiCapabilityRegistry.js';


/**
 * Authentication Middleware
 * 1. Intercepts HttpOnly cookies ('access_token') to prevent XSS credential theft.
 * 2. Allows the same signed Pharma token through Authorization for trusted API clients.
 * 3. Enforces MFA Step-Up: Checks Authenticator Assurance Level (AAL1 vs AAL2).
 * 4. Attaches sanitized user context to req.user.
 */
export const authenticateUser = async (req, res, next) => {
    // 1. Check HttpOnly cookie first (XSS Hardened)
    let token = req.cookies?.['access_token'];

    // 2. Fallback to Authorization Header
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            token = authHeader.slice(7).trim();
        }
    }

    if (!token || token === 'undefined' || token === 'null') {
        return res.status(401).json({
            message: 'Authentication session required.',
            code: 'SESSION_REQUIRED'
        });
    }

    // All development and production sessions use the same Pharma RS256 token format.
    // 5. First-party Pharma RS256 session token.
    // Supabase is deliberately NOT accepted here. It is used only as an
    // upstream Google identity during the one-time token exchange.
    try {
        const { payload } = await verifyPharmaAccessToken(token);
        if (!['pharma_access', 'pharma_onboarding', 'pharma_mfa_challenge'].includes(payload.token_type)
            || typeof payload.sub !== 'string' || !payload.sub) {
            throw new Error('Invalid Pharma token claims.');
        }
        const tokenType = payload.token_type;
        const accountStatus = payload.accountStatus || 'ACTIVE';
        const url = req.originalUrl || req.url || '';
        if (tokenType === 'pharma_onboarding'
            && !url.includes('/api/v1/auth/complete-profile')
            && !url.includes('/api/v1/auth/onboarding')
            && !url.includes('/api/v1/auth/logout')) {
            return res.status(403).json({ message: 'Onboarding session is restricted to profile completion.', code: 'ONBOARDING_SESSION_RESTRICTED' });
        }
        if (tokenType === 'pharma_mfa_challenge'
            && !url.includes('/api/v1/auth/mfa/verify')) {
            return res.status(403).json({ message: 'MFA challenge session is restricted to MFA verification.', code: 'MFA_SESSION_RESTRICTED' });
        }
        if (accountStatus !== 'ACTIVE' && tokenType === 'pharma_access') {
            throw new Error('Inactive account session.');
        }
        const role = payload.role || (Array.isArray(payload.roles) ? payload.roles.find(value => ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin', 'TENANT_ADMIN', 'TENANT_OWNER', 'pharmacy', 'PHARMACIST', 'PHARMACY_STAFF'].includes(value)) : null) || 'customer';
        req.user = {
            sub: payload.sub,
            id: payload.sub,
            email: payload.email || '',
            name: payload.name || '',
            firstName: payload.firstName || '',
            lastName: payload.lastName || '',
            role,
            roles: Array.isArray(payload.roles) && payload.roles.length ? payload.roles : [role],
            permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
            revokedPermissions: Array.isArray(payload.revokedPermissions) ? payload.revokedPermissions : [],
            permissionVersion: Number(payload.permissionVersion || 1),
            tenantId: payload.tenantId || null,
            branchId: payload.branchId || null,
            scope: payload.scope || 'CUSTOMER',
            app_metadata: {
                role,
                tenantId: payload.tenantId || null,
                permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
                revokedPermissions: Array.isArray(payload.revokedPermissions) ? payload.revokedPermissions : []
            },
            user_metadata: {
                name: payload.name || '',
                mobile: payload.mobile || '',
                dateOfBirth: payload.dateOfBirth || null,
                gender: payload.gender || null
            },
            aal: payload.aal || 'aal1',
            sessionId: payload.sessionId || null,
            tokenType,
            accountStatus
        };

        // Central API capability enforcement. Individual routes can add
        // resource/ownership checks, but developers cannot accidentally omit
        // the permission gate for an endpoint registered as protected.
        const capability = resolveApiCapability(req.method, req.originalUrl || req.url || '');
        if (capability && !authorizationService.isAllowed(req.user, capability.permission)) {
            return res.status(403).json({
                success: false,
                code: 'FORBIDDEN',
                message: 'You do not have permission to access this API.',
                permission: capability.permission
            });
        }

        return next();
    } catch {
        // Invalid signature, issuer, audience, or expiry.
    }


    // Supabase JWTs are no longer accepted as application sessions.
    // Google OAuth must first exchange the upstream identity for a Pharma token.
    return res.status(401).json({ message: 'Invalid or expired authentication token.', code: 'INVALID_PHARMA_TOKEN' });
};

export const requirePlatformSuperAdmin = (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role || req.context?.role;
    if (role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN') return next();
    return res.status(403).json({
        success: false,
        error: {
            code: 'FORBIDDEN',
            message: 'Platform Super Administrator privileges required.',
            requestId: req.context?.requestId
        }
    });
};

// Backward-compatible middleware for existing admin routes.
export const requireSuperAdmin = (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role || req.context?.role;
    if (role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN' || role === 'admin') return next();
    return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Platform administrator privileges required.', requestId: req.context?.requestId }
    });
};

export const isAdmin = (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role || req.context?.role;
    const allowed = ['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER'];
    if (!allowed.includes(role)) {
        return res.status(403).json({
            message: 'Access denied. Administrator privileges required.'
        });
    }
    return next();
};

export const isPharmacyOrAdmin = (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role || req.context?.role;
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
    const permissions = Array.isArray(req.user?.permissions)
        ? req.user.permissions
        : (Array.isArray(req.user?.app_metadata?.permissions) ? req.user.app_metadata.permissions : []);
    const allowed = ['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER', 'pharmacy', 'PHARMACIST', 'PHARMACY_STAFF'];
    if (allowed.includes(role) || roles.some(value => allowed.includes(value)) || permissions.includes('*')) {
        return next();
    }
    return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Access denied. Pharmacist or Administrator privileges required.'
    });
};

export const requirePermission = (permission) => async (req, res, next) => {
    try {
        const role = req.user?.app_metadata?.role || req.user?.role || req.context?.role;
        if (role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN' || role === 'admin') return next();
        const allowed = authorizationService.isAllowed(req.user, permission);
        if (allowed) return next();
        return res.status(403).json({
            success: false,
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
            permission
        });
    } catch (error) {
        return next(error);
    }
};

export default { authenticateUser, requireSuperAdmin, isAdmin, isPharmacyOrAdmin, requirePermission };
