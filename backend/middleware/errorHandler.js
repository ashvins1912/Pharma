const databaseErrors = new Set([
    'MongoServerError',
    'MongoNetworkError',
    'MongooseError',
    'MongoTimeoutError',
    'MongoServerSelectionError'
]);

export function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    const databaseUnavailable = databaseErrors.has(error.name)
        || error.message?.includes('buffering timed out');
    const suppliedStatus = Number(error.statusCode || error.status);
    const status = databaseUnavailable
        ? 503
        : Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599
            ? suppliedStatus
            : 500;
    const code = status === 503 ? 'SERVICE_UNAVAILABLE'
        : status === 400 ? 'INVALID_REQUEST'
            : status === 401 ? 'UNAUTHENTICATED'
                : status === 403 ? 'FORBIDDEN'
                    : status === 404 ? 'NOT_FOUND'
                        : status === 409 ? 'CONFLICT'
                            : status === 413 ? 'PAYLOAD_TOO_LARGE'
                                : 'INTERNAL_ERROR';
    const message = status < 500
        ? error.message || 'Request could not be completed.'
        : databaseUnavailable
            ? 'A required database service is unavailable.'
            : 'Internal server error.';

    console.error('Unhandled HTTP request error:', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        code,
        errorName: error.name || 'Error'
    });

    return res.status(status).json({
        success: false,
        error: { code, message },
        requestId: req.requestId
    });
}
