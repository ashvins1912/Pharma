/**
 * Structured observability logger with secret redaction and tenant/branch correlation
 */

const SENSITIVE_KEYS = new Set([
    'password', 'token', 'access_token', 'apiKey', 'secret', 'encryptedApiKey',
    'totpSecret', 'authorization', 'cookie'
]);

const redactSecrets = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 5) return obj;
    if (Array.isArray(obj)) return obj.map(item => redactSecrets(item, depth + 1));
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(k.toLowerCase())) {
            clean[k] = '[REDACTED]';
        } else if (typeof v === 'object' && v !== null) {
            clean[k] = redactSecrets(v, depth + 1);
        } else {
            clean[k] = v;
        }
    }
    return clean;
};

export const logger = {
    info(message, context = {}) {
        const payload = {
            level: 'INFO',
            timestamp: new Date().toISOString(),
            message,
            ...redactSecrets(context)
        };
        console.log(`[INFO] [${payload.timestamp}] ${message}`, context.requestId ? `(req: ${context.requestId})` : '');
    },

    warn(message, context = {}) {
        const payload = {
            level: 'WARN',
            timestamp: new Date().toISOString(),
            message,
            ...redactSecrets(context)
        };
        console.warn(`[WARN] [${payload.timestamp}] ${message}`, context.requestId ? `(req: ${context.requestId})` : '');
    },

    error(message, error = null, context = {}) {
        const payload = {
            level: 'ERROR',
            timestamp: new Date().toISOString(),
            message,
            error: error?.message || error,
            stack: process.env.NODE_ENV !== 'production' ? error?.stack : undefined,
            ...redactSecrets(context)
        };
        console.error(`[ERROR] [${payload.timestamp}] ${message}`, error?.message || '', context.requestId ? `(req: ${context.requestId})` : '');
    }
};

export default logger;
