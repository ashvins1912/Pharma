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
    return new SignJWT({
        email: user.email,
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer('pharma-demo-customer')
        .setAudience('pharma-api')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(getSigningKey());
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
