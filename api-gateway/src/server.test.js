import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import { loadConfig } from './config.js';
import { createGatewayApp } from './server.js';

const start = async app => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
};

const startMockServer = handler => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done()))
    }));
    server.once('error', reject);
  });
};

const testSecrets = {
  gateway: 'test-gateway-secret-that-is-longer-than-thirty-two-characters',
  service: 'test-service-secret-that-is-longer-than-thirty-two-characters'
};

const authorizedConfig = (backendApiUrl, serviceUrl) => loadConfig({
  NODE_ENV: 'test',
  BACKEND_API_URL: backendApiUrl,
  INVENTORY_SERVICE_URL: serviceUrl,
  ORDER_SERVICE_URL: serviceUrl,
  GATEWAY_AUTH_SECRET: testSecrets.gateway,
  SERVICE_AUTH_SECRET: testSecrets.service,
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  PROXY_TIMEOUT_MS: '3000'
});

test('gateway responds to health without an Origin header', async () => {
  const app = createGatewayApp(loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://127.0.0.1:8090',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
  }), {
    snapshot: () => ({ overallStatus: 'HEALTHY', checkedAt: '2026-10-03T00:00:00Z', services: [] }),
    checkNow: async () => ({ overallStatus: 'HEALTHY', checkedAt: '2026-10-03T00:00:00Z', services: [] })
  });
  const server = await start(app);
  try {
    const response = await fetch(`${server.url}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, 'api-gateway');
  } finally {
    await server.close();
  }
});

test('gateway proxies public catalog and csrf routes without authentication', async () => {
  const seen = [];
  const backend = await startMockServer((req, res) => {
    seen.push(req.url);
    if (req.url.startsWith('/api/medicines')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ medicines: [{ _id: 'med-1', name: 'Test Medicine' }], total: 1 }));
      return;
    }
    if (req.url === '/api/v1/auth/csrf') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ csrfToken: 'test-csrf' }));
      return;
    }
    res.writeHead(404).end();
  });
  const app = createGatewayApp(loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: backend.url,
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
  }));
  const gateway = await start(app);

  try {
    const catalog = await fetch(gateway.url + '/api/medicines?page=1&limit=16');
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).medicines[0].name, 'Test Medicine');

    const csrf = await fetch(gateway.url + '/api/v1/auth/csrf');
    assert.equal(csrf.status, 200);
    assert.equal((await csrf.json()).csrfToken, 'test-csrf');
    assert.deepEqual(seen, ['/api/medicines?page=1&limit=16', '/api/v1/auth/csrf']);
  } finally {
    await Promise.all([gateway.close(), backend.close()]);
  }
});

test('gateway handles preflight before proxying to the backend', async () => {
  const app = createGatewayApp(loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://127.0.0.1:8090',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
  }));
  const server = await start(app);
  try {
    const response = await fetch(`${server.url}/api/v1/orders`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,idempotency-key'
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  } finally {
    await server.close();
  }
});

test('gateway returns a controlled error for a rejected origin', async () => {
  const app = createGatewayApp(loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://127.0.0.1:8090',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
  }));
  const server = await start(app);
  try {
    const response = await fetch(`${server.url}/api/v1/orders`, {
      headers: { Origin: 'https://untrusted.example' }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'CORS_ORIGIN_NOT_ALLOWED');
  } finally {
    await server.close();
  }
});

test('gateway authenticates the user and issues a scoped Order Service token', async () => {
  let serviceAuthorization = '';
  let forwardedUserAuthorization = '';
  const backend = await startMockServer((req, res) => {
    if (req.url !== '/internal/gateway/authenticate') {
      res.writeHead(404).end();
      return;
    }
    const assertion = (req.headers['x-gateway-authorization'] || '').slice(7);
    assert.doesNotThrow(() => jwt.verify(assertion, testSecrets.gateway, {
      algorithms: ['HS256'],
      issuer: 'ashvin-pharmacy',
      audience: 'pharma-backend-auth',
      subject: 'api-gateway'
    }));
    forwardedUserAuthorization = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user: {
        sub: 'customer-42',
        email: 'customer@example.com',
        app_metadata: { role: 'customer' },
        user_metadata: { name: 'Test Customer', mobile: '+10000000000' }
      }
    }));
  });
  const service = await startMockServer((req, res) => {
    serviceAuthorization = req.headers.authorization;
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, body }));
    });
  });
  const app = createGatewayApp(authorizedConfig(backend.url, service.url));
  const gateway = await start(app);

  try {
    const response = await fetch(`${gateway.url}/api/v1/orders/`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-user-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'checkout-42'
      },
      body: JSON.stringify({ items: [{ productId: 'MED-42', quantity: 1 }] })
    });
    assert.equal(response.status, 201);
    assert.equal(forwardedUserAuthorization, 'Bearer valid-user-token');
    const claims = jwt.verify(serviceAuthorization.slice(7), testSecrets.service, {
      algorithms: ['HS256'],
      issuer: 'ashvin-pharmacy',
      audience: 'order-service',
      subject: 'api-gateway'
    });
    assert.equal(claims.scope, 'orders.create');
    assert.equal(claims.userId, 'customer-42');
    assert.equal(claims.userRole, 'customer');
    assert.equal(claims.email, 'customer@example.com');
    const forwarded = await response.json();
    assert.equal(forwarded.path, '/api/v1/orders/');
    assert.equal(JSON.parse(forwarded.body).items[0].productId, 'MED-42');
  } finally {
    await Promise.all([gateway.close(), backend.close(), service.close()]);
  }
});

test('gateway returns 401 for protected API requests without a session', async () => {
  const backend = await startMockServer((_req, res) => {
    res.writeHead(500).end();
  });
  const app = createGatewayApp(authorizedConfig(backend.url, backend.url));
  const gateway = await start(app);

  try {
    const response = await fetch(gateway.url + '/api/admin/medicine-requests?page=1&pageSize=15');
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'SESSION_REQUIRED');

    const refreshable = await fetch(gateway.url + '/api/admin/medicine-requests?page=1&pageSize=15', {
      headers: { Cookie: 'refresh_token=present' }
    });
    assert.equal(refreshable.status, 401);
    assert.equal(refreshable.headers.get('x-session-refreshable'), 'true');
  } finally {
    await Promise.all([gateway.close(), backend.close()]);
  }
});

test('gateway rejects invalid user credentials before contacting a service', async () => {
  let serviceCalled = false;
  const backend = await startMockServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Invalid or expired authentication token.' }));
  });
  const service = await startMockServer((_req, res) => {
    serviceCalled = true;
    res.writeHead(200).end();
  });
  const app = createGatewayApp(authorizedConfig(backend.url, service.url));
  const gateway = await start(app);

  try {
    const response = await fetch(`${gateway.url}/api/v1/orders`, {
      headers: { Authorization: 'Bearer invalid-user-token' }
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'INVALID_AUTHENTICATION');
    assert.equal(serviceCalled, false);
  } finally {
    await Promise.all([gateway.close(), backend.close(), service.close()]);
  }
});

test('gateway returns unavailable for unconfigured Inventory and preserves Order backend fallback', async () => {
  let orderFallbackPath = '';
  const backend = await startMockServer((req, res) => {
    orderFallbackPath = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ implementation: 'backend' }));
  });
  const gatewayConfig = loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: backend.url,
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
  });
  const gateway = await start(createGatewayApp(gatewayConfig));

  try {
    const inventoryResponse = await fetch(`${gateway.url}/api/v1/inventory/med-1`);
    assert.equal(inventoryResponse.status, 503);
    assert.equal((await inventoryResponse.json()).error.code, 'SERVICE_UNAVAILABLE');

    const orderResponse = await fetch(`${gateway.url}/api/v1/orders?limit=1`);
    assert.equal(orderResponse.status, 200);
    assert.equal((await orderResponse.json()).implementation, 'backend');
    assert.equal(orderFallbackPath, '/api/v1/orders?limit=1');
  } finally {
    await Promise.all([gateway.close(), backend.close()]);
  }
});

test('gateway requires admin role for Inventory adjustment and signs import scopes', async () => {
  let serviceClaims;
  let serviceRequestCount = 0;
  let serviceCookie;
  let serviceIdempotencyKey;
  let serviceOrigin;
  let forwardedGatewayAssertion;
  const backend = await startMockServer((req, res) => {
    const token = req.headers.authorization;
    const admin = token === 'Bearer admin-user-token';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user: {
        sub: admin ? 'admin-1' : 'customer-1',
        app_metadata: { role: admin ? 'admin' : 'customer' },
        user_metadata: {}
      }
    }));
  });
  const service = await startMockServer((req, res) => {
    serviceRequestCount += 1;
    serviceCookie = req.headers.cookie;
    serviceIdempotencyKey = req.headers['idempotency-key'];
    serviceOrigin = req.headers.origin;
    forwardedGatewayAssertion = req.headers['x-gateway-authorization'];
    const serviceToken = req.headers.authorization.slice(7);
    serviceClaims = jwt.verify(serviceToken, testSecrets.service, {
      algorithms: ['HS256'],
      issuer: 'ashvin-pharmacy',
      audience: 'inventory-service',
      subject: 'api-gateway'
    });
    req.resume();
    req.on('end', () => {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: true }));
    });
  });
  const app = createGatewayApp(authorizedConfig(backend.url, service.url));
  const gateway = await start(app);

  try {
    const denied = await fetch(`${gateway.url}/api/v1/inventory/adjust`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer customer-user-token',
        Cookie: 'access_token=customer-user-token',
        'Content-Type': 'application/json'
      },
      body: '{}'
    });
    assert.equal(denied.status, 403);

    const uploaded = await fetch(`${gateway.url}/api/v1/inventory/imports`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-user-token',
        Cookie: 'access_token=admin-user-token',
        Origin: 'http://localhost:3000',
        'X-Gateway-Authorization': 'Bearer untrusted-client-value',
        'Content-Type': 'multipart/form-data; boundary=upload-boundary',
        'Idempotency-Key': 'inventory-import-1'
      },
      body: '--upload-boundary--\r\n'
    });
    assert.equal(uploaded.status, 202);
    assert.equal(serviceClaims.scope, 'inventory.import');
    assert.equal(serviceClaims.userId, 'admin-1');
    assert.equal(serviceClaims.userRole, 'admin');
    assert.equal(serviceClaims.email, undefined);
    assert.equal(serviceClaims.customerName, undefined);
    assert.equal(serviceClaims.customerMobile, undefined);
    assert.equal(serviceRequestCount, 1);
    assert.equal(serviceCookie, undefined);
    assert.equal(serviceIdempotencyKey, 'inventory-import-1');
    assert.equal(serviceOrigin, undefined);
    assert.equal(forwardedGatewayAssertion, undefined);
  } finally {
    await Promise.all([gateway.close(), backend.close(), service.close()]);
  }
});
