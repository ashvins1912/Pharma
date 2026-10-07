import { issuePharmaAccessToken } from '../security/pharmaToken.js';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';

const demoCustomerEnabled = env.NODE_ENV === 'production'
    ? process.env.DEMO_CUSTOMER_ENABLED === 'true'
    : process.env.DEMO_CUSTOMER_ENABLED !== 'false';
const configuredSecret = process.env.DEMO_CUSTOMER_JWT_SECRET || '';
const signingSecret = env.NODE_ENV === 'production'
    ? configuredSecret
    : configuredSecret || 'local-only-demo-customer-signing-key';

const getSigningKey = () => {
    if (signingSecret.length < 32) {
        throw new Error('DEMO_CUSTOMER_JWT_SECRET must contain at least 32 characters.');
    }
    return new TextEncoder().encode(signingSecret);
};

export const isDemoCustomerEnabled = () => demoCustomerEnabled;

export const getDemoCustomerIdentity = () => ({
    id: 'demo-customer',
    email: process.env.DEMO_CUSTOMER_EMAIL || 'customer@ashvinpharma.com',
    app_metadata: { role: 'customer' },
    user_metadata: {
        name: process.env.DEMO_CUSTOMER_NAME || 'Demo Customer',
        mobile: process.env.DEMO_CUSTOMER_MOBILE || ''
    }
});

export const issueDemoCustomerToken = async () => {
    if (!demoCustomerEnabled) throw new Error('Demo customer access is disabled.');
    const user = getDemoCustomerIdentity();
    return issuePharmaAccessToken({
        sub: user.id,
        email: user.email,
        name: user.user_metadata?.name || 'Demo Customer',
        role: 'customer',
        roles: ['customer'],
        permissions: ['orders.read', 'orders.create', 'prescription.read', 'prescription.write'],
        scope: 'CUSTOMER'
    });
};
export const verifyDemoCustomerToken = async token => {
    if (!demoCustomerEnabled) return null;
    try {
        const { payload } = await jwtVerify(token, getSigningKey(), {
            algorithms: ['HS256'],
            issuer: 'pharma-demo-customer',
            audience: 'pharma-api'
        });
        if (payload.sub !== 'demo-customer' || payload.email !== getDemoCustomerIdentity().email) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
};
