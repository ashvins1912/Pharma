import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'origin',
  'x-gateway-authorization',
  'x-gateway-trusted-authorization'
]);

export function proxyRequest(
  req,
  res,
  targetBase = config.backendApiUrl,
  serviceAuthorization = null,
  proxyConfig = config,
  upstreamName = 'Backend'
) {
  const requestId = req.requestId || randomUUID();
  const upstreamCode = upstreamName === 'Backend'
    ? 'BACKEND'
    : upstreamName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([name]) => !hopByHopHeaders.has(name.toLowerCase()))
  );
  // Never forward identity headers supplied by the browser. Internal identity
  // context is re-created below only after the gateway authenticates the user.
  delete headers['x-user-id'];
  delete headers['x-tenant-id'];
  if (serviceAuthorization) {
    delete headers.authorization;
    delete headers.cookie;
    delete headers['x-xsrf-token'];
    delete headers['x-csrf-token'];
    headers.authorization = serviceAuthorization;
    if (req.gatewayAuthenticated) headers['x-gateway-trusted-authorization'] = serviceAuthorization;
    // The canonical application identity is the verified token subject (sub).
    // Some auth adapters do not populate a separate id field.
    const userId = req.user?.sub || req.user?.id;
    if (userId) headers['x-user-id'] = String(userId);
    const tenantId = req.user?.tenantId || req.user?.app_metadata?.tenantId;
    if (tenantId) headers['x-tenant-id'] = String(tenantId);
  }
  headers['x-request-id'] = requestId;
  headers['x-correlation-id'] = req.correlationId || requestId;
  headers['x-forwarded-for'] = req.socket.remoteAddress || '';
  headers['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  headers['x-forwarded-host'] = req.get('host') || '';

  const targetTransport = new URL(targetBase).protocol === 'https:' ? https : http;
  const upstream = targetTransport.request(new URL(req.originalUrl, targetBase), {
    method: req.method,
    headers
  }, upstreamResponse => {
    res.statusCode = upstreamResponse.statusCode || 502;
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !hopByHopHeaders.has(name.toLowerCase())) res.setHeader(name, value);
    }
    upstreamResponse.on('error', error => {
      console.error(`API Gateway ${upstreamName} response failed:`, { requestId, code: error.code || error.name });
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          error: { code: 'UPSTREAM_RESPONSE_FAILED', message: 'Upstream service response failed.' },
          requestId
        });
      } else {
        res.destroy(error);
      }
    });
    upstreamResponse.pipe(res);
  });

  upstream.setTimeout(proxyConfig.proxyTimeoutMs, () => {
    const error = new Error('Upstream request timed out.');
    error.code = 'ETIMEDOUT';
    upstream.destroy(error);
  });
  upstream.on('error', error => {
    const timedOut = error.code === 'ETIMEDOUT';
    console.error(`API Gateway ${upstreamName} request failed:`, {
      requestId,
      method: req.method,
      path: req.path,
      code: error.code || error.name
    });
    if (res.headersSent) return res.destroy(error);
    return res.status(timedOut ? 504 : 503).json({
      success: false,
      error: {
        code: timedOut ? `${upstreamCode}_TIMEOUT` : `${upstreamCode}_UNAVAILABLE`,
        message: timedOut ? `${upstreamName} request timed out.` : `${upstreamName} is unavailable.`
      },
      requestId
    });
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}
