import crypto from 'node:crypto';

const ACTION = 'PAYMENT_SNOOZE';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

const getSecret = () => {
    const secret = process.env.SYSTEM_SECRET_KEY;
    if (typeof secret !== 'string' || secret.length < 32) {
        const error = new Error('SYSTEM_SECRET_KEY must contain at least 32 characters to enable signed payment actions.');
        error.code = 'SIGNED_ACTIONS_NOT_CONFIGURED';
        throw error;
    }
    return secret;
};

const sign = (payload, secret) => crypto.createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

export const createPaymentSnoozeToken = (customerId, {
    now = Date.now(),
    ttlSeconds = DEFAULT_TTL_SECONDS
} = {}) => {
    if (typeof customerId !== 'string' || !customerId.trim()) {
        throw new TypeError('A customer ID is required.');
    }
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) {
        throw new TypeError('Token lifetime must be a positive integer.');
    }
    const payload = Buffer.from(JSON.stringify({
        sub: customerId,
        action: ACTION,
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + ttlSeconds,
        nonce: crypto.randomUUID()
    })).toString('base64url');
    return `${payload}.${sign(payload, getSecret())}`;
};

export const verifyPaymentSnoozeToken = (token, { now = Date.now() } = {}) => {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) {
        return null;
    }
    let expected;
    try {
        expected = Buffer.from(sign(parts[0], getSecret()));
    } catch {
        return null;
    }
    const provided = Buffer.from(parts[1]);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        const nowSeconds = Math.floor(now / 1000);
        if (payload.action !== ACTION || typeof payload.sub !== 'string' || !payload.sub
            || typeof payload.nonce !== 'string' || !payload.nonce
            || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
            || payload.iat > nowSeconds || payload.exp <= nowSeconds) return null;
        return { customerId: payload.sub, action: payload.action, nonce: payload.nonce, expiresAt: new Date(payload.exp * 1000) };
    } catch {
        return null;
    }
};

export const createRiderDeliveryActionToken = (claims, { now = Date.now(), ttlSeconds = 24 * 60 * 60 } = {}) => {
    if (!claims || typeof claims.orderId !== 'string' || typeof claims.riderId !== 'string'
        || !['cash_received', 'payment_pending', 'not_reachable'].includes(claims.action)) {
        throw new TypeError('Valid order, rider, and delivery action claims are required.');
    }
    const payload = Buffer.from(JSON.stringify({
        sub: claims.riderId,
        orderId: claims.orderId,
        action: claims.action,
        eventId: crypto.randomUUID(),
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + ttlSeconds,
        nonce: crypto.randomUUID()
    })).toString('base64url');
    return `${payload}.${sign(payload, getSecret())}`;
};

export const verifyRiderDeliveryActionToken = (token, { now = Date.now() } = {}) => {
    if (typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
    const expected = Buffer.from(sign(parts[0], getSecret()));
    const provided = Buffer.from(parts[1]);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        const nowSeconds = Math.floor(now / 1000);
        if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.orderId !== 'string'
            || !['cash_received', 'payment_pending', 'not_reachable'].includes(payload.action)
            || typeof payload.eventId !== 'string' || typeof payload.nonce !== 'string'
            || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
            || payload.iat > nowSeconds || payload.exp <= nowSeconds) return null;
        return { riderId: payload.sub, orderId: payload.orderId, action: payload.action, eventId: payload.eventId, expiresAt: new Date(payload.exp * 1000) };
    } catch { return null; }
};
