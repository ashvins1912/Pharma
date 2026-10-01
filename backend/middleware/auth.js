import 'dotenv/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { verifyDemoAdminToken } from '../config/demoAdmin.js';
import { verifyDemoCustomerToken } from '../config/demoCustomer.js';
import { env } from '../config/env.js';

const { SUPABASE_URL } = env;
let SUPABASE_JWKS = null;

if (SUPABASE_URL && SUPABASE_URL.startsWith('https://')) {
    try {
        SUPABASE_JWKS = createRemoteJWKSet(
            new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
        );
    } catch (error) {
        console.error('Failed to initialize Supabase JWKS:', error);
    }
}

const isDemoAuthEnabled = env.NODE_ENV !== 'production';
const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const LOCAL_SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

/**
 * Authentication Middleware
 * 1. Intercepts HttpOnly cookies ('access_token') to prevent XSS credential theft.
 * 2. Fallbacks to Authorization: Bearer header for cross-client API consumers.
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

    // 3. Signed demo customer sessions
    const demoCustomer = await verifyDemoCustomerToken(token);
    if (demoCustomer) {
        req.user = {
            ...demoCustomer,
            id: demoCustomer.sub,
            aal: 'aal1'
        };
        return next();
    }

    // Legacy local-only demo token
    if (isDemoAuthEnabled && token === 'demo-customer-token') {
        req.user = {
            sub: 'demo-customer-id',
            id: 'demo-customer-id',
            email: 'customer@ashvinpharma.com',
            app_metadata: { role: 'customer' },
            user_metadata: { name: 'Ashvin Singh', mobile: '+91 95899 16475' },
            aal: 'aal1'
        };
        return next();
    }

    // 4. Demo Admin token
    const demoAdmin = await verifyDemoAdminToken(token);
    if (demoAdmin) {
        req.user = {
            ...demoAdmin,
            id: demoAdmin.sub,
            aal: demoAdmin.aal || 'aal2'
        };
        return next();
    }

    // 5. Check Local/Intermediate JWT signature (for TOTP AAL2 sessions)
    try {
        const { payload } = await jwtVerify(token, LOCAL_SIGNING_KEY, {
            algorithms: ['HS256']
        });

        // Check if token is only an intermediate MFA challenge token attempting to access protected endpoints
        if (payload.mfa_required && !payload.mfa_verified) {
            return res.status(403).json({
                message: 'Two-factor authentication step incomplete. Please submit your 6-digit TOTP code.',
                code: 'MFA_CHALLENGE_REQUIRED'
            });
        }

        req.user = {
            sub: payload.sub,
            id: payload.sub,
            email: payload.email,
            app_metadata: payload.app_metadata || { role: payload.role || 'customer' },
            user_metadata: payload.user_metadata || {},
            aal: payload.aal || 'aal1'
        };
        return next();
    } catch {
        // Fallthrough to Supabase JWKS verification
    }

    // 6. Supabase RS256 JWKS verification
    if (!SUPABASE_JWKS || !SUPABASE_URL) {
        return res.status(401).json({ message: 'Invalid or expired authentication token.' });
    }

    try {
        const { payload } = await jwtVerify(token, SUPABASE_JWKS, {
            issuer: `${SUPABASE_URL}/auth/v1`,
            audience: 'authenticated'
        });

        if (typeof payload.sub !== 'string' || !payload.sub) {
            return res.status(401).json({ message: 'Invalid authentication token claims.' });
        }

        req.user = {
            sub: payload.sub,
            id: payload.sub,
            email: payload.email,
            app_metadata: payload.app_metadata || {},
            user_metadata: payload.user_metadata || {},
            aal: payload.aal || 'aal1'
        };
        return next();
    } catch (error) {
        console.warn('Authentication token verification rejected:', error.message);
        return res.status(401).json({ message: 'Invalid or expired authentication token.' });
    }
};

export const authenticateSupabaseUser = async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'A Supabase bearer token is required.' });
    }
    if (!SUPABASE_JWKS || !SUPABASE_URL) {
        return res.status(401).json({ error: 'Supabase authentication is not configured.' });
    }

    try {
        const { payload } = await jwtVerify(token, SUPABASE_JWKS, {
            issuer: `${SUPABASE_URL}/auth/v1`,
            audience: 'authenticated'
        });
        if (typeof payload.sub !== 'string' || !payload.sub) {
            return res.status(401).json({ error: 'The Supabase token does not include a valid user ID.' });
        }
        req.user = {
            supabaseId: payload.sub,
            sub: payload.sub,
            email: payload.email,
            app_metadata: payload.app_metadata || {},
            user_metadata: payload.user_metadata || {}
        };
        return next();
    } catch {
        return res.status(401).json({ error: 'The Supabase bearer token is invalid or expired.' });
    }
};

export const isAdmin = (req, res, next) => {
    if (req.user?.app_metadata?.role !== 'admin' && req.user?.role !== 'admin') {
        return res.status(403).json({
            message: 'Access denied. Administrator privileges required.'
        });
    }
    return next();
};

export const isPharmacyOrAdmin = (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role;
    if (role === 'admin' || role === 'pharmacy') {
        return next();
    }
    return res.status(403).json({
        message: 'Access denied. Pharmacist or Administrator privileges required.'
    });
};

export default { authenticateUser, isAdmin, isPharmacyOrAdmin };
