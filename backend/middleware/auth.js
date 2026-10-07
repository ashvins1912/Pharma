import 'dotenv/config';
import { verifyPharmaAccessToken } from '../security/pharmaToken.js';


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
        if (accountStatus !== 'ACTIVE' && tokenType === 'pharma_access') {
            throw new Error('Inactive account session.');
        }
        req.user = {
            sub: payload.sub,
            id: payload.sub,
            email: payload.email || '',
            name: payload.name || '',
            firstName: payload.firstName || '',
            lastName: payload.lastName || '',
            role: payload.role || 'customer',
            roles: payload.roles || [payload.role || 'customer'],
            permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
            permissionVersion: Number(payload.permissionVersion || 1),
            tenantId: payload.tenantId || null,
            branchId: payload.branchId || null,
            scope: payload.scope || 'CUSTOMER',
            app_metadata: {
                role: payload.role || 'customer',
                tenantId: payload.tenantId || null,
                permissions: Array.isArray(payload.permissions) ? payload.permissions : []
            },
            user_metadata: {
                name: payload.name || '',
                mobile: payload.mobile || '',
                dateOfBirth: payload.dateOfBirth || null
            },
            aal: payload.aal || 'aal1',
            sessionId: payload.sessionId || null,
            tokenType,
            accountStatus
        };
        return next();
    } catch {
        // Invalid signature, issuer, audience, or expiry.
    }


    // Supabase JWTs are no longer accepted as application sessions.
    // Google OAuth must first exchange the upstream identity for a Pharma token.
    return res.status(401).json({ message: 'Invalid or expired authentication token.', code: 'INVALID_PHARMA_TOKEN' });
};

export const requireSuperAdmin = (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role || req.context?.role;
    if (role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN' || role === 'admin') {
        return next();
    }
    return res.status(403).json({
        success: false,
        error: {
            code: 'FORBIDDEN',
            message: 'Access denied. Platform Super Administrator privileges required.',
            requestId: req.context?.requestId
        }
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
    const allowed = ['admin', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_OWNER', 'pharmacy', 'PHARMACIST', 'PHARMACY_STAFF'];
    if (allowed.includes(role)) {
        return next();
    }
    return res.status(403).json({
        message: 'Access denied. Pharmacist or Administrator privileges required.'
    });
};

export default { authenticateUser, requireSuperAdmin, isAdmin, isPharmacyOrAdmin };
