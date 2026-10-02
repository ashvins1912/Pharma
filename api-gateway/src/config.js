import 'dotenv/config';

function parseOrigin(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || parsed.username
      || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function isExactBrowserOrigin(origin, production) {
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.origin === origin
      && !parsed.username
      && !parsed.password
      && (!production || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

export function loadConfig(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const originsValue = environment.CORS_ALLOWED_ORIGINS
    || (production ? '' : 'http://localhost:3000,http://localhost:5173,http://0.0.0.0:3000');
  const allowedOrigins = originsValue.split(',').map(origin => origin.trim()).filter(Boolean);
  const backendApiUrl = parseOrigin(environment.BACKEND_API_URL || (production ? '' : 'http://localhost:8090'));
  const inventoryServiceUrl = parseOrigin(environment.INVENTORY_SERVICE_URL || '');
  const orderServiceUrl = parseOrigin(environment.ORDER_SERVICE_URL || '');
  const serviceAuthSecret = environment.SERVICE_AUTH_SECRET || '';
  const gatewayAuthSecret = environment.GATEWAY_AUTH_SECRET || '';
  const errors = [];

  if (!allowedOrigins.length) errors.push('CORS_ALLOWED_ORIGINS must contain at least one exact origin.');
  if (allowedOrigins.some(origin => !isExactBrowserOrigin(origin, production))) {
    errors.push('CORS_ALLOWED_ORIGINS entries must be exact HTTP(S) origins; production origins must use HTTPS.');
  }
  if (!backendApiUrl) {
    errors.push('BACKEND_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  if (environment.INVENTORY_SERVICE_URL && !inventoryServiceUrl) {
    errors.push('INVENTORY_SERVICE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  if (environment.ORDER_SERVICE_URL && !orderServiceUrl) {
    errors.push('ORDER_SERVICE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  if (production && !environment.BACKEND_API_URL) errors.push('BACKEND_API_URL is required in production.');
  if ((inventoryServiceUrl || orderServiceUrl) && serviceAuthSecret.length < 32) {
    errors.push('SERVICE_AUTH_SECRET must contain at least 32 characters when a service URL is configured.');
  }
  if ((inventoryServiceUrl || orderServiceUrl) && gatewayAuthSecret.length < 32) {
    errors.push('GATEWAY_AUTH_SECRET must contain at least 32 characters when a service URL is configured.');
  }
  if (production && gatewayAuthSecret.length < 32) {
    errors.push('GATEWAY_AUTH_SECRET must contain at least 32 characters in production.');
  }
  const port = Number(environment.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be an integer from 1 to 65535.');
  }
  const proxyTimeoutMs = Number(environment.PROXY_TIMEOUT_MS || 120_000);
  if (!Number.isInteger(proxyTimeoutMs) || proxyTimeoutMs < 1) {
    errors.push('PROXY_TIMEOUT_MS must be a positive integer.');
  }
  const authTimeoutMs = Number(environment.AUTH_TIMEOUT_MS || 15_000);
  if (!Number.isInteger(authTimeoutMs) || authTimeoutMs < 1) {
    errors.push('AUTH_TIMEOUT_MS must be a positive integer.');
  }
  if (errors.length) throw new Error(`Invalid API Gateway configuration: ${errors.join(' ')}`);

  return {
    port,
    backendApiUrl,
    inventoryServiceUrl,
    orderServiceUrl,
    serviceAuthSecret,
    gatewayAuthSecret,
    serviceJwtIssuer: environment.SERVICE_JWT_ISSUER || 'ashvin-pharmacy',
    inventoryJwtAudience: environment.SERVICE_JWT_AUDIENCE || 'inventory-service',
    orderJwtAudience: environment.ORDER_SERVICE_JWT_AUDIENCE || 'order-service',
    allowedOrigins: [...new Set(allowedOrigins)],
    proxyTimeoutMs: Math.min(proxyTimeoutMs, 300_000),
    authTimeoutMs: Math.min(authTimeoutMs, 30_000)
  };
}

export const config = loadConfig();
