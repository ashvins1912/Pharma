import crypto from 'node:crypto';

/**
 * Session Hardening & Anti-CSRF Token Security
 * 
 * 1. Mitigates XSS by delivering JWT access tokens inside HttpOnly, Secure, SameSite cookies.
 * 2. Mitigates CSRF via a cryptographically random Double Submit Cookie pattern (XSRF-TOKEN + X-XSRF-TOKEN).
 */

const isProduction = process.env.NODE_ENV === 'production';

// Cookie options adhering to OWASP Session Management Cheat Sheet
export const COOKIE_CONFIG = {
    ACCESS_TOKEN: {
        httpOnly: true,
        secure: isProduction,
        // Production browser traffic is same-origin through the frontend /api rewrite.
        // Lax is the stronger compatible posture for this deployment.
        path: '/',
        maxAge: 60 * 60 * 1000 // 1 hour
    },
    REFRESH_TOKEN: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        // The browser reaches the API through /api and may use both /api/v1/auth/*
        // and gateway-routed API paths. Keep the refresh credential available
        // to the entire same-origin API surface; it remains HttpOnly + Secure.
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    },
    CSRF_TOKEN: {
        httpOnly: false, // Client JavaScript reads this cookie and sends it back in X-XSRF-TOKEN header
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
};

/**
 * Generate a cryptographically secure 256-bit random CSRF token
 */
export function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Attach HttpOnly session cookies and client-readable CSRF cookie to response
 */
export function setSessionCookies(res, { accessToken, refreshToken = null, csrfToken = null }) {
    if (accessToken) {
        res.cookie('access_token', accessToken, COOKIE_CONFIG.ACCESS_TOKEN);
    }
    if (refreshToken) {
        res.cookie('refresh_token', refreshToken, COOKIE_CONFIG.REFRESH_TOKEN);
    }
    const tokenToSet = csrfToken || generateCsrfToken();
    res.cookie('XSRF-TOKEN', tokenToSet, COOKIE_CONFIG.CSRF_TOKEN);
    return tokenToSet;
}

/**
 * Wipe all authentication and CSRF cookies on logout
 */
export function clearSessionCookies(res) {
    res.clearCookie('access_token', { path: '/' });
    // Clear both the current root-scoped cookie and the legacy auth-scoped cookie.
    res.clearCookie('refresh_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    res.clearCookie('XSRF-TOKEN', { path: '/' });
}

/**
 * Anti-CSRF Middleware: Validates Double-Submit Cookie pattern on mutating requests
 */
export function csrfProtection(req, res, next) {
    // Safe HTTP methods do not alter server state
    const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
    if (SAFE_METHODS.includes(req.method)) {
        return next();
    }

    // Exempt public unauthenticated onboarding/login endpoints where no session cookie exists yet
    const PUBLIC_EXEMPT_ROUTES = [
        '/api/v1/auth/login',
        '/api/v1/auth/signup',
        '/api/v1/auth/google',
        '/api/v1/auth/activate',
        '/api/v1/auth/verify-email',
        '/api/v1/auth/resend-verification',
        '/api/v1/auth/password/forgot',
        '/api/v1/auth/password/reset',
        '/api/v1/auth/mfa/verify',
        '/api/auth/demo-admin',
        '/api/auth/demo-admin/instant',
        '/api/auth/demo-customer'
    ];

    if (PUBLIC_EXEMPT_ROUTES.some(route => req.path === route || req.originalUrl?.startsWith(route))) {
        return next();
    }

    const cookieToken = req.cookies?.['XSRF-TOKEN'];
    const headerToken = req.headers['x-xsrf-token']
        || req.headers['x-csrf-token']
        || req.body?._csrf;

    // If an access_token cookie is present, CSRF protection is mandatory
    if (req.cookies?.['access_token']) {
        if (!cookieToken || !headerToken) {
            return res.status(403).json({
                message: 'CSRF token missing. Please refresh and include the X-XSRF-TOKEN header.',
                code: 'CSRF_MISSING'
            });
        }

        // Timing-safe comparison to prevent side-channel timing attacks
        const bufCookie = Buffer.from(String(cookieToken));
        const bufHeader = Buffer.from(String(headerToken));

        if (bufCookie.length !== bufHeader.length || !crypto.timingSafeEqual(bufCookie, bufHeader)) {
            return res.status(403).json({
                message: 'Invalid CSRF token rejected.',
                code: 'CSRF_INVALID'
            });
        }
    }

    next();
}

export default {
    COOKIE_CONFIG,
    generateCsrfToken,
    setSessionCookies,
    clearSessionCookies,
    csrfProtection
};
