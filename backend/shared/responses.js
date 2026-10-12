/**
 * Standard API Response Helpers for Ashvin Pharmacy Platform
 * Enforces unified contract:
 * Success: { success: true, data: {}, message: "...", requestId: "req_..." }
 * Error: { success: false, error: { code: "...", message: "...", details: [] }, requestId: "req_..." }
 */
export function getRequestId(req) {
    return req?.context?.requestId || req?.headers?.['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function sendSuccess(res, {
    data = {},
    message = 'Operation completed successfully',
    statusCode = 200,
    req = null
} = {}) {
    const requestId = getRequestId(req || res.req);
    return res.status(statusCode).json({
        success: true,
        data,
        message,
        requestId
    });
}

export function sendError(res, {
    code = 'INTERNAL_SERVER_ERROR',
    message = 'An unexpected error occurred.',
    details = [],
    statusCode = 400,
    req = null
} = {}) {
    const requestId = getRequestId(req || res.req);
    return res.status(statusCode).json({
        success: false,
        error: {
            code,
            message,
            details: Array.isArray(details) ? details : [details]
        },
        requestId
    });
}
