/** Apply defense-in-depth browser response headers at the public API boundary. */
export function applySecurityHeaders(_req, res, next, { production = process.env.NODE_ENV === 'production' } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // API responses are not HTML documents; this policy blocks framing, plugins and base-tag injection
  // without breaking the frontend's separately hosted scripts, styles or product-image hosts.
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  return next();
}
