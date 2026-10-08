import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function sameValue(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getOriginFromReferer(referer) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function reject(res, requestId, code, message) {
  return res.status(403).json({
    success: false,
    error: { code, message },
    requestId
  });
}

/**
 * Browser request security is enforced at the public API gateway because the
 * gateway is the real browser trust boundary. The backend deliberately strips
 * browser cookies before forwarding trusted requests, so backend-only CSRF
 * middleware cannot protect gateway-authenticated browser mutations.
 *
 * Policy:
 * - Safe methods are never blocked by this middleware.
 * - Cross-site Fetch Metadata is rejected for every state-changing request.
 * - An explicit Origin/Referer must be a configured browser origin when sent.
 * - Requests carrying an application session cookie must present the
 *   double-submit XSRF-TOKEN in X-XSRF-TOKEN/X-CSRF-TOKEN.
 * - Anonymous authentication endpoints rely on exact Origin/Referer validation;
 *   this also prevents login CSRF without requiring an extra bootstrap request.
 * - Non-browser service clients that do not send browser origin metadata remain
 *   compatible, but cannot use a browser session cookie without the CSRF proof.
 */
export function enforceBrowserRequestSecurity(req, res, next, gatewayConfig) {
  if (SAFE_METHODS.has(String(req.method || 'GET').toUpperCase())) return next();

  const requestId = req.requestId;
  const origin = req.get('origin') || '';
  const referer = req.get('referer') || '';
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  const allowedOrigins = new Set(gatewayConfig.allowedOrigins || []);

  if (fetchSite === 'cross-site') {
    return reject(res, requestId, 'CSRF_CROSS_SITE_BLOCKED', 'Cross-site state-changing requests are not allowed.');
  }

  if (origin) {
    if (origin === 'null' || !allowedOrigins.has(origin)) {
      return reject(res, requestId, 'CSRF_ORIGIN_REJECTED', 'Request origin is not trusted.');
    }
  } else if (referer) {
    const refererOrigin = getOriginFromReferer(referer);
    if (!refererOrigin || !allowedOrigins.has(refererOrigin)) {
      return reject(res, requestId, 'CSRF_REFERER_REJECTED', 'Request referer is not trusted.');
    }
  }

  const cookies = parseCookies(req.get('cookie') || '');
  const hasAccessCookie = Boolean(cookies.access_token);
  const csrfCookie = cookies['XSRF-TOKEN'];
  const csrfHeader = req.get('x-xsrf-token') || req.get('x-csrf-token') || '';

  if (hasAccessCookie && !sameValue(csrfCookie, csrfHeader)) {
    return reject(res, requestId, 'CSRF_INVALID', 'A valid CSRF token is required for authenticated state changes.');
  }

  return next();
}
