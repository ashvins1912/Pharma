import 'dotenv/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { verifyDemoAdminToken } from '../config/demoAdmin.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
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

const isDemoAuthEnabled = process.env.NODE_ENV !== 'production';

export const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token || token === 'undefined' || token === 'null') {
        return res.status(401).json({ message: 'Authentication required.' });
    }

    if (isDemoAuthEnabled && token === 'demo-customer-token') {
        req.user = {
            sub: 'demo-customer-id',
            email: 'customer@ashvinpharma.com',
            app_metadata: { role: 'customer' },
            user_metadata: { name: 'Ashvin Singh', mobile: '+91 95899 16475' }
        };
        return next();
    }

    const demoAdmin = await verifyDemoAdminToken(token);
    if (demoAdmin) {
        req.user = demoAdmin;
        return next();
    }

    if (!SUPABASE_JWKS || !SUPABASE_URL) {
        return res.status(503).json({ message: 'Authentication service is not configured.' });
    }

    try {
        const { payload } = await jwtVerify(token, SUPABASE_JWKS, {
            issuer: `${SUPABASE_URL}/auth/v1`,
            audience: 'authenticated'
        });
        if (typeof payload.sub !== 'string' || !payload.sub) {
            return res.status(401).json({ message: 'Invalid authentication token.' });
        }
        req.user = payload;
        return next();
    } catch (error) {
        console.warn('Authentication token rejected:', error.message);
        return res.status(401).json({ message: 'Invalid or expired authentication token.' });
    }
};

export const isAdmin = (req, res, next) => {
    if (req.user?.app_metadata?.role !== 'admin') {
        return res.status(403).json({
            message: 'Access denied. Admin authorization required.'
        });
    }
    return next();
};

export default { authenticateUser, isAdmin };
