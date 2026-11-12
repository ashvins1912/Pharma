import { randomUUID } from 'node:crypto';

const validId = value => /^[a-zA-Z0-9._:-]{1,128}$/.test(value || '');

export function requestContext(req, res, next) {
    const suppliedRequestId = req.get('x-request-id') || '';
    const suppliedCorrelationId = req.get('x-correlation-id') || '';
    req.requestId = validId(suppliedRequestId) ? suppliedRequestId : randomUUID();
    req.correlationId = validId(suppliedCorrelationId) ? suppliedCorrelationId : req.requestId;
    res.set('X-Request-Id', req.requestId);
    res.set('X-Correlation-Id', req.correlationId);
    return next();
}

export default requestContext;
