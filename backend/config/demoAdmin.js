import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const demoAdminEnabled = process.env.NODE_ENV !== 'production'
    && process.env.DEMO_ADMIN_ENABLED !== 'false';
const instantDemoAdminEnabled = demoAdminEnabled
    && process.env.DEMO_ADMIN_INSTANT_ACCESS_ENABLED !== 'false';
const demoAdminEmail = (process.env.DEMO_ADMIN_EMAIL || 'ashvinsingh25@gmail.com').trim().toLowerCase();
const demoAdminUserId = process.env.DEMO_ADMIN_USER_ID || 'admin';

const getSigningKey = () => {
    const secret = process.env.DEMO_ADMIN_JWT_SECRET && process.env.DEMO_ADMIN_JWT_SECRET.length >= 32
        ? process.env.DEMO_ADMIN_JWT_SECRET
        : 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
    return new TextEncoder().encode(secret);
};

export const isDemoAdminEnabled = () => demoAdminEnabled;
export const isInstantDemoAdminEnabled = () => instantDemoAdminEnabled;

export const issueDemoAdminToken = async (instant = false) => {
    if (!demoAdminEnabled) throw new Error('Demo admin sign-in is disabled.');
    if (instant && !instantDemoAdminEnabled) {
        throw new Error('Instant demo admin access is disabled.');
    }
    return new SignJWT({
        email: demoAdminEmail,
        app_metadata: { role: 'admin' },
        user_metadata: { name: 'Demo Admin' }
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(demoAdminUserId)
        .setIssuer('pharma-demo-admin')
        .setAudience('pharma-api')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(getSigningKey());
};

export const verifyDemoAdminToken = async (token) => {
    if (!demoAdminEnabled) return null;
    try {
        const { payload } = await jwtVerify(token, getSigningKey(), {
            algorithms: ['HS256'],
            issuer: 'pharma-demo-admin',
            audience: 'pharma-api'
        });
        if (payload.sub !== demoAdminUserId || payload.email !== demoAdminEmail
            || payload.app_metadata?.role !== 'admin') {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
};

export const verifyDemoAdminPassword = (email, password) => {
    const configuredPassword = process.env.DEMO_ADMIN_PASSWORD || 'Admin@123';
    if (!demoAdminEnabled || !configuredPassword
        || String(email || '').trim().toLowerCase() !== demoAdminEmail) {
        return false;
    }

    const provided = Buffer.from(String(password || ''));
    const expected = Buffer.from(configuredPassword);
    return provided.length === expected.length
        && provided.length > 0
        && timingSafeEqual(provided, expected);
};

export const getDemoAdminIdentity = () => ({
    id: demoAdminUserId,
    email: demoAdminEmail,
    app_metadata: { role: 'admin' },
    user_metadata: { name: 'Demo Admin' }
});
