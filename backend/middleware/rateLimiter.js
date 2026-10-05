/**
 * Memory-based Rate Limiter for Authentication & Onboarding Security
 */
const requestBuckets = new Map();

/**
 * Creates an Express rate-limiting middleware
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default 15 minutes)
 * @param {number} options.max - Max allowed requests per IP in the window
 * @param {string} options.message - Error message when rate limit is exceeded
 */
export function createRateLimiter({
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests. Please try again later.'
} = {}) {
    // In test environment, allow high threshold so automated test suites run smoothly
    const effectiveMax = process.env.NODE_ENV === 'test' ? 1000 : max;

    return (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-client';
        const routeKey = `${req.baseUrl || ''}${req.path}`;
        const key = `${ip}:${routeKey}`;
        const now = Date.now();

        let bucket = requestBuckets.get(key);
        if (!bucket || now - bucket.startTime > windowMs) {
            bucket = {
                startTime: now,
                count: 1
            };
            requestBuckets.set(key, bucket);
            return next();
        }

        bucket.count += 1;

        if (bucket.count > effectiveMax) {
            const retryAfterSec = Math.ceil((bucket.startTime + windowMs - now) / 1000);
            res.setHeader('Retry-After', retryAfterSec);
            return res.status(429).json({
                success: false,
                code: 'RATE_LIMIT_EXCEEDED',
                message,
                retryAfter: retryAfterSec
            });
        }

        next();
    };
}

// Pre-configured rate limiters
export const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
});

export const onboardingLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many onboarding requests. Please slow down.'
});
