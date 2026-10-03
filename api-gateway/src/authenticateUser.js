import { createBackendAuthToken } from './serviceAuth.js';
import { config } from './config.js';

function getUserToken(req) {
  const authorization = req.get('authorization') || '';
  if (/^Bearer\s+\S+$/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '');
  const accessCookie = (req.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith('access_token='));
  if (!accessCookie) return '';
  try {
    return decodeURIComponent(accessCookie.slice('access_token='.length));
  } catch {
    return '';
  }
}

export async function authenticateUser(req, res, next, gatewayConfig = config) {
  const userToken = getUserToken(req);
  if (!userToken || userToken === 'undefined' || userToken === 'null') {
    return res.status(401).json({
      success: false,
      error: { code: 'SESSION_REQUIRED', message: 'Authentication session required.' },
      requestId: req.requestId
    });
  }

  let response;
  try {
    const assertion = createBackendAuthToken(gatewayConfig);
    response = await fetch(`${gatewayConfig.backendApiUrl}/internal/gateway/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'X-Gateway-Authorization': `Bearer ${assertion}`,
        'X-Request-ID': req.requestId,
        'X-Correlation-ID': req.correlationId,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(gatewayConfig.authTimeoutMs)
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    console.error('Gateway user authentication could not reach the backend:', {
      requestId: req.requestId,
      code: error.code || error.name
    });
    return res.status(timedOut ? 504 : 503).json({
      success: false,
      error: {
        code: timedOut ? 'AUTHENTICATION_TIMEOUT' : 'AUTHENTICATION_UNAVAILABLE',
        message: timedOut ? 'Authentication request timed out.' : 'Authentication service is unavailable.'
      },
      requestId: req.requestId
    });
  }

  if (!response.ok) {
    const status = response.status === 403 ? 403 : response.status === 401 ? 401 : 503;
    const code = status === 403 ? 'FORBIDDEN'
      : status === 401 ? 'INVALID_AUTHENTICATION'
        : 'AUTHENTICATION_UNAVAILABLE';
    return res.status(status).json({
      success: false,
      error: {
        code,
        message: status === 403 ? 'Access is denied.' : status === 401
          ? 'Authentication token is invalid or expired.'
          : 'Authentication service is unavailable.'
      },
      requestId: req.requestId
    });
  }

  try {
    const result = await response.json();
    if (!result.user || typeof result.user.sub !== 'string') {
      throw new Error('Authentication response is missing a user identity.');
    }
    req.user = result.user;
    return next();
  } catch (error) {
    console.error('Gateway received an invalid authentication response:', {
      requestId: req.requestId,
      code: error.code || error.name
    });
    return res.status(502).json({
      success: false,
      error: { code: 'INVALID_AUTHENTICATION_RESPONSE', message: 'Authentication service returned an invalid response.' },
      requestId: req.requestId
    });
  }
}

export function requireAdmin(req, res, next) {
  const role = req.user?.app_metadata?.role || req.user?.role;
  if (role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required.' },
      requestId: req.requestId
    });
  }
  return next();
}
