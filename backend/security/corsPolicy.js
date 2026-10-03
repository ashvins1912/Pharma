import cors from 'cors';

export const corsOriginErrorCode = 'CORS_ORIGIN_NOT_ALLOWED';

export function createCorsMiddleware(allowedOrigins) {
    const allowed = new Set(allowedOrigins);
    return cors({
        origin(origin, callback) {
            if (!origin || allowed.has(origin)) return callback(null, true);
            return callback(Object.assign(new Error('Request origin is not allowed.'), {
                code: corsOriginErrorCode
            }));
        },
        credentials: true,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Accept',
            'Authorization',
            'Content-Type',
            'Idempotency-Key',
            'X-Request-ID',
            'X-Correlation-ID',
            'X-XSRF-TOKEN',
            'X-CSRF-TOKEN'
        ],
        exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
        maxAge: 600,
        optionsSuccessStatus: 204
    });
}

export function corsErrorHandler(error, req, res, next) {
    if (error?.code !== corsOriginErrorCode) return next(error);
    console.warn('Rejected cross-origin request:', {
        requestId: req.requestId,
        origin: req.get('origin') || null
    });
    return res.status(403).json({
        success: false,
        error: {
            code: corsOriginErrorCode,
            message: 'Request origin is not allowed.'
        },
        requestId: req.requestId
    });
}
