import { issuePharmaAccessToken } from '../security/pharmaToken.js';
import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';

const demoAdminEnabled = ['development', 'test'].includes(env.NODE_ENV)
    && process.env.DEMO_ADMIN_ENABLED !== 'false';
const instantDemoAdminEnabled = demoAdminEnabled
    && process.env.DEMO_ADMIN_INSTANT_ACCESS_ENABLED !== 'false';
const demoAdminEmail = (process.env.DEMO_ADMIN_EMAIL || 'ashvinsingh25@gmail.com').trim().toLowerCase();
const demoAdminUserId = process.env.DEMO_ADMIN_USER_ID || 'admin';
const configuredPassword = process.env.DEMO_ADMIN_PASSWORD || '';
const configuredSecret = process.env.DEMO_ADMIN_JWT_SECRET || '';

const getSigningKey = () => {
    const secret = process.env.DEMO_ADMIN_JWT_SECRET || configuredSecret || (env.NODE_ENV !== 'production' ? 'development-demo-admin-secret-key-32-chars-long' : '');
    if (secret.length < 32) {
        throw new Error('DEMO_ADMIN_JWT_SECRET must contain at least 32 characters.');
    }
    return new TextEncoder().encode(secret);
};

export const isDemoAdminEnabled = () => demoAdminEnabled;
export const isInstantDemoAdminEnabled = () => instantDemoAdminEnabled;

export const issueDemoAdminToken = async (instant = false) => {
    if (!demoAdminEnabled) throw new Error('Demo admin sign-in is disabled.');
    if (instant && !instantDemoAdminEnabled) throw new Error('Instant demo admin access is disabled.');
    return issuePharmaAccessToken({
        sub: demoAdminUserId,
        email: demoAdminEmail,
        name: 'Demo Admin',
        role: 'SUPER_ADMIN',
        roles: ['SUPER_ADMIN'],
        permissions: ['*'],
        scope: 'PLATFORM'
    });
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
