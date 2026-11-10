import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import { loadConfig } from './config.js';
import { createGatewayApp } from './server.js';
import { createTrustedBackendRequestToken } from './serviceAuth.js';
import { isGatewayPublicPath, isGatewayPermissionAllowed, resolveGatewayCapability } from './apiCapabilityRegistry.js';

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

test('notification read mutation is registered with profile.write and remains protected', () => {
  const path = '/api/v1/notifications/notif-d91ed961-a003-4210-96cf-6e7beb1b301a/read';
  assert.equal(resolveGatewayCapability('PATCH', path), 'profile.write');
  assert.equal(isGatewayPermissionAllowed({ role: 'customer', permissions: ['profile.write'] }, 'profile.write'), true);
  assert.equal(isGatewayPermissionAllowed({ role: 'customer', permissions: ['profile.read'] }, 'profile.write'), false);
  assert.equal(resolveGatewayCapability('PATCH', '/api/v1/notifications/read-all'), null);
});

test('inventory safety alerts are registered as a protected inventory read capability', () => {
  assert.equal(resolveGatewayCapability('GET', '/api/v1/inventory/alerts'), 'inventory.read');
  assert.equal(resolveGatewayCapability('GET', '/api/medicines/admin/suggest-restock'), 'inventory.read');
  assert.equal(resolveGatewayCapability('POST', '/api/medicines/admin/apply-restock'), 'inventory.write');
  assert.equal(isGatewayPermissionAllowed({ role: 'TENANT_ADMIN', permissions: ['inventory.read'] }, 'inventory.read'), true);
  assert.equal(isGatewayPermissionAllowed({ role: 'TENANT_ADMIN', permissions: [] }, 'inventory.read'), false);
});

test('storefront medicine catalog is public and does not require inventory RBAC', () => {
  const url = '/api/medicines?page=1&limit=16';
  assert.equal(isGatewayPublicPath('GET', url), true);
  assert.equal(resolveGatewayCapability('GET', url), null);

  // Mutations must remain protected even though the public read is allowed.
  assert.equal(isGatewayPublicPath('POST', '/api/medicines'), false);
  assert.equal(resolveGatewayCapability('POST', '/api/medicines'), 'inventory.write');
});

test('storefront branch discovery is public while branch mutations remain protected', () => {
  const url = '/api/v1/branches/all';
  assert.equal(isGatewayPublicPath('GET', url), true);
  assert.equal(resolveGatewayCapability('GET', url), null);

  // Only the read-only active branch directory is public.
  assert.equal(isGatewayPublicPath('POST', '/api/v1/branches/all'), false);
  assert.equal(resolveGatewayCapability('POST', '/api/v1/branches/all'), 'tenants.manage');
});

test('staged inventory batch APIs require the explicit inventory.import capability', () => {
  const batch = '/api/v1/inventory/imports/batches/550e8400-e29b-41d4-a716-446655440000';
  const protectedRoutes = [
    ['POST', '/api/v1/inventory/imports/preview'],
    ['GET', '/api/v1/inventory/imports/batches'],
    ['GET', batch],
    ['GET', `${batch}/rows`],
    ['GET', `${batch}/invalid-records/download`],
    ['PATCH', `${batch}/rows/550e8400-e29b-41d4-a716-446655440000%3A2`],
    ['POST', `${batch}/publish`],
    ['POST', `${batch}/unpublish`],
    ['POST', `${batch}/rollback`],
    ['POST', `${batch}/rows/edit-selected`],
    ['POST', `${batch}/rows/550e8400-e29b-41d4-a716-446655440000%3A2/publish`]
  ];
  for (const [method, path] of protectedRoutes) {
    assert.equal(resolveGatewayCapability(method, path), 'inventory.import', `${method} ${path}`);
  }
  assert.equal(isGatewayPermissionAllowed({ role: 'TENANT_ADMIN', permissions: ['inventory.import'] }, 'inventory.import'), true);
  assert.equal(isGatewayPermissionAllowed({ role: 'TENANT_ADMIN', permissions: ['inventory.read'] }, 'inventory.import'), false);
  assert.equal(resolveGatewayCapability('DELETE', `${batch}/rows/550e8400-e29b-41d4-a716-446655440000%3A2`), null);
});

test('shared medicine catalogue import jobs and batch actions are registered with the platform catalogue capability', () => {
  const jobId = '25a15b46-db97-44ea-a245-915d64698547';
  const batchId = 'catalogue-batch-123';
  const protectedRoutes = [
    ['GET', '/api/v1/inventory/catalogue/imports'],
    ['POST', '/api/v1/inventory/catalogue/imports/preview'],
    ['POST', '/api/v1/inventory/catalogue/imports/merge'],
    ['POST', '/api/v1/inventory/catalogue/imports/remove-selected'],
    ['GET', `/api/v1/inventory/catalogue/imports/jobs/${jobId}`],
    ['POST', `/api/v1/inventory/catalogue/imports/jobs/${jobId}/retry`],
    ['POST', `/api/v1/inventory/catalogue/imports/jobs/${jobId}/restart`],
    ['GET', `/api/v1/inventory/catalogue/imports/${batchId}`],
    ['GET', `/api/v1/inventory/catalogue/imports/${batchId}/records`],
    ['POST', `/api/v1/inventory/catalogue/imports/${batchId}/approve`],
    ['POST', `/api/v1/inventory/catalogue/imports/${batchId}/publish`]
  ];
  for (const [method, routePath] of protectedRoutes) {
    assert.equal(resolveGatewayCapability(method, routePath), 'inventory.catalogue.import', `${method} ${routePath}`);
  }
  assert.equal(isGatewayPermissionAllowed({ role: 'PLATFORM_SUPER_ADMIN', permissions: ['inventory.catalogue.import'] }, 'inventory.catalogue.import'), true);
  assert.equal(resolveGatewayCapability('DELETE', `/api/v1/inventory/catalogue/imports/${batchId}`), null);
});

test('delivery OTP endpoints use least-privilege rider and pharmacy capabilities', () => {
  const orderId = '6accca6691b2129986259f9c';
  assert.equal(resolveGatewayCapability('GET', `/api/orders/${orderId}/reveal-otp`), 'orders.read');
  assert.equal(resolveGatewayCapability('POST', `/api/orders/${orderId}/resend-otp`), 'orders.read');
  assert.equal(resolveGatewayCapability('POST', `/api/orders/${orderId}/verify-delivery`), 'delivery.read');
  assert.equal(isGatewayPermissionAllowed({ role: 'RIDER', permissions: ['delivery.read'] }, 'delivery.read'), true);
  assert.equal(isGatewayPermissionAllowed({ role: 'RIDER', permissions: ['delivery.read'] }, 'delivery.manage'), false);
});

test('intelligent order and medicine-request waitlist endpoints require explicit capabilities', () => {
  const orderRoutes = [
    ['POST', '/api/orders/fulfillment/preview'],
    ['POST', '/api/orders/fulfillment/waitlist'],
    ['POST', '/api/orders/fulfillment/waitlist/6acab8869852d76d01a594e7/confirm'],
    ['POST', '/api/orders/fulfillment/waitlist/6acab8869852d76d01a594e7/cancel'],
    ['POST', '/api/orders/fulfillment/waitlist/6acab8869852d76d01a594e7/link-order']
  ];
  for (const [method, path] of orderRoutes) {
    assert.equal(resolveGatewayCapability(method, path), 'orders.create', `${method} ${path}`);
  }
  assert.equal(resolveGatewayCapability('GET', '/api/orders/fulfillment/waitlist'), 'orders.read');
  assert.equal(resolveGatewayCapability('POST', '/api/medicine-requests/6acab8869852d76d01a594e7/waitlist'), 'medicine_requests.decide');
  assert.equal(resolveGatewayCapability('GET', '/api/medicine-requests/6acab8869852d76d01a594e7/fulfillment/preview'), 'medicine_requests.decide');
  assert.equal(resolveGatewayCapability('POST', '/api/medicine-requests/6acab8869852d76d01a594e7/fulfillment/confirm'), 'medicine_requests.decide');
  assert.equal(resolveGatewayCapability('GET', '/api/admin/medicine-requests/6acab8869852d76d01a594e7/fulfillment-options'), 'medicine_requests.read');
});

test('admin medicine request proposal requires the proposal capability', () => {
  const path = '/api/admin/medicine-requests/6acab8869852d76d01a594e7/proposal';
  assert.equal(resolveGatewayCapability('POST', path), 'medicine_requests.proposal');

  // Scoped tenant staff need an explicit permission; they are not granted a global role bypass.
  assert.equal(isGatewayPermissionAllowed({
    role: 'TENANT_ADMIN',
    permissions: ['medicine_requests.proposal']
  }, 'medicine_requests.proposal'), true);
  assert.equal(isGatewayPermissionAllowed({
    role: 'TENANT_ADMIN',
    permissions: ['medicine_requests.read']
  }, 'medicine_requests.proposal'), false);
});

test('customer person DELETE is registered as profile.write without opening other customer DELETE routes', () => {
  const personPath = '/api/v1/customers/persons/PUID-0FDB8DDF449EF67E4C371517';
  assert.equal(resolveGatewayCapability('DELETE', personPath), 'profile.write');
  assert.equal(isGatewayPermissionAllowed({
    role: 'customer',
    permissions: ['profile.write']
  }, 'profile.write'), true);
  assert.equal(isGatewayPermissionAllowed({
    role: 'customer',
    permissions: ['profile.read']
  }, 'profile.write'), false);

  // The registration is intentionally narrow: other customer DELETE endpoints
  // stay unregistered until they receive their own explicit authorization policy.
  assert.equal(resolveGatewayCapability('DELETE', '/api/v1/customers/me'), null);
});

test('explicit revocations override Super Admin wildcard grants', () => {
  const user = {
    role: 'SUPER_ADMIN',
    permissions: ['*'],
    revokedPermissions: ['inventory.read']
  };
  assert.equal(isGatewayPermissionAllowed(user, 'inventory.read'), false);
  assert.equal(isGatewayPermissionAllowed(user, 'inventory.write'), true);
});

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
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000,https://pharma-ui.onrender.com'
  }));
  const gateway = await start(app);

  try {
    const catalog = await fetch(gateway.url + '/api/medicines?page=1&limit=16', {
      headers: { Origin: 'https://pharma-ui.onrender.com' }
    });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.headers.get('access-control-allow-origin'), 'https://pharma-ui.onrender.com');
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
  let validatedScopeClaims;
  const backend = await startMockServer((req, res) => {
    if (req.url === '/internal/gateway/validate-tenant-branch') {
      const assertion = String(req.headers['x-gateway-authorization'] || '').replace(/^Bearer /, '');
      validatedScopeClaims = jwt.verify(assertion, testSecrets.gateway, { algorithms: ['HS256'], issuer: 'ashvin-pharmacy', audience: 'pharma-backend-auth', subject: 'api-gateway' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ valid: true, tenantId: validatedScopeClaims.tenantId, branchId: validatedScopeClaims.branchId }));
      return;
    }
    const token = req.headers.authorization;
    const admin = token === 'Bearer admin-user-token';
    const tenantAdmin = token === 'Bearer tenant-admin-user-token';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user: {
        sub: admin ? 'admin-1' : tenantAdmin ? 'tenant-admin-1' : 'customer-1',
        tenantId: tenantAdmin ? 'tenant-ashvin-main' : null,
        branchId: tenantAdmin ? 'branch-stale-from-token' : null,
        permissions: tenantAdmin ? ['inventory.import'] : [],
        app_metadata: {
          role: admin ? 'admin' : tenantAdmin ? 'TENANT_ADMIN' : 'customer',
          tenantId: tenantAdmin ? 'tenant-ashvin-main' : null,
          permissions: tenantAdmin ? ['inventory.import'] : []
        },
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
        'X-Tenant-Id': 'tenant-ashvin-main',
        'X-Branch-Id': 'branch-indore-central',
        'Content-Type': 'multipart/form-data; boundary=upload-boundary',
        'Idempotency-Key': 'inventory-import-1'
      },
      body: '--upload-boundary--\r\n'
    });
    assert.equal(uploaded.status, 202);
    assert.equal(serviceClaims.scope, 'inventory.import');
    assert.equal(serviceClaims.userId, 'admin-1');
    assert.equal(serviceClaims.userRole, 'admin');
    assert.equal(serviceClaims.tenantId, 'tenant-ashvin-main');
    assert.equal(serviceClaims.branchId, 'branch-indore-central');
    assert.equal(validatedScopeClaims.scope, 'tenant:branch:verify');
    assert.equal(validatedScopeClaims.userId, 'admin-1');
    assert.equal(validatedScopeClaims.tenantId, 'tenant-ashvin-main');
    assert.equal(validatedScopeClaims.branchId, 'branch-indore-central');
    assert.equal(serviceClaims.email, undefined);
    assert.equal(serviceClaims.customerName, undefined);
    assert.equal(serviceClaims.customerMobile, undefined);
    assert.equal(serviceRequestCount, 1);
    assert.equal(serviceCookie, undefined);
    assert.equal(serviceIdempotencyKey, 'inventory-import-1');
    assert.equal(serviceOrigin, undefined);
    assert.equal(forwardedGatewayAssertion, undefined);

    // A tenant administrator may switch to another branch in their own tenant.
    // The selected UI branch must take precedence over a stale branch claim,
    // but Backend API validation remains mandatory.
    const tenantBranchUpload = await fetch(`${gateway.url}/api/v1/inventory/imports/preview`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tenant-admin-user-token',
        'X-Branch-Id': 'branch-selected-in-ui',
        'Content-Type': 'multipart/form-data; boundary=upload-boundary'
      },
      body: '--upload-boundary--\r\n'
    });
    assert.equal(tenantBranchUpload.status, 202);
    assert.equal(validatedScopeClaims.tenantId, 'tenant-ashvin-main');
    assert.equal(validatedScopeClaims.branchId, 'branch-selected-in-ui');
    assert.equal(serviceClaims.tenantId, 'tenant-ashvin-main');
    assert.equal(serviceClaims.branchId, 'branch-selected-in-ui');
    assert.equal(serviceRequestCount, 2);
  } finally {
    await Promise.all([gateway.close(), backend.close(), service.close()]);
  }
});


test('pharmacy profile reads are available to tenant admins but policy changes remain Super Admin-only', () => {
  assert.equal(resolveGatewayCapability('GET', '/api/v1/vendor/profile'), 'tenant.profile.read');
  assert.equal(resolveGatewayCapability('GET', '/api/v1/vendor/profile/edit-policy'), 'tenant.profile.read');
  assert.equal(resolveGatewayCapability('PATCH', '/api/v1/vendor/profile'), 'profile.write');
  assert.equal(resolveGatewayCapability('PATCH', '/api/v1/vendor/profile/edit-policy'), 'tenants.manage');

  for (const role of ['TENANT_ADMIN', 'TENANT_OWNER', 'OWNER']) {
    assert.equal(isGatewayPermissionAllowed({ role }, 'tenant.profile.read'), true);
    assert.equal(isGatewayPermissionAllowed({ role }, 'tenants.manage'), false);
  }
  assert.equal(isGatewayPermissionAllowed({
    role: 'TENANT_ADMIN',
    permissions: ['*'],
    revokedPermissions: ['tenant.profile.read']
  }, 'tenant.profile.read'), false);
  assert.equal(isGatewayPermissionAllowed({ role: 'SUPER_ADMIN' }, 'tenant.profile.read'), true);
  assert.equal(isGatewayPermissionAllowed({ role: 'SUPER_ADMIN' }, 'tenants.manage'), true);
});

test('tenant staff membership and activity endpoints are registered with tenant-scoped gateway permissions', () => {
  assert.equal(resolveGatewayCapability('GET', '/api/v1/tenants/tenant-1/memberships'), 'tenant.branches.read');
  assert.equal(resolveGatewayCapability('POST', '/api/v1/tenants/tenant-1/memberships'), 'tenant.branches.manage');
  assert.equal(resolveGatewayCapability('PATCH', '/api/v1/tenants/tenant-1/memberships/member-1'), 'tenant.branches.manage');
  assert.equal(resolveGatewayCapability('DELETE', '/api/v1/tenants/tenant-1/memberships/member-1'), 'tenant.branches.manage');
  assert.equal(resolveGatewayCapability('GET', '/api/v1/activity?page=1'), 'tenant.branches.read');
  for (const role of ['TENANT_ADMIN', 'TENANT_OWNER', 'OWNER']) {
    assert.equal(isGatewayPermissionAllowed({ role }, 'tenant.branches.read'), true);
    assert.equal(isGatewayPermissionAllowed({ role }, 'tenant.branches.manage'), true);
  }
});

test('tenant branch CRUD endpoints are registered and tenant admins are allowed by gateway policy', () => {
  assert.equal(resolveGatewayCapability('GET', '/api/tenant/branches?page=1'), 'tenant.branches.read');
  assert.equal(resolveGatewayCapability('POST', '/api/tenant/branches'), 'tenant.branches.manage');
  assert.equal(resolveGatewayCapability('PATCH', '/api/tenant/branches/branch-1'), 'tenant.branches.manage');
  assert.equal(resolveGatewayCapability('PATCH', '/api/tenant/branches/branch-1/status'), 'tenant.branches.manage');
  assert.equal(resolveGatewayCapability('DELETE', '/api/tenant/branches/branch-1'), 'tenant.branches.manage');
  for (const role of ['TENANT_ADMIN', 'TENANT_OWNER', 'OWNER']) {
    assert.equal(isGatewayPermissionAllowed({ role }, 'tenant.branches.read'), true);
    assert.equal(isGatewayPermissionAllowed({ role }, 'tenant.branches.manage'), true);
  }
  assert.equal(isGatewayPermissionAllowed({
    role: 'TENANT_STAFF',
    revokedPermissions: ['tenant.branches.manage'],
    permissions: ['*']
  }, 'tenant.branches.manage'), false);
});

test('trusted backend identity carries a selected tenant for uppercase platform ADMIN', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://127.0.0.1:8090',
    GATEWAY_AUTH_SECRET: testSecrets.gateway,
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
  });
  const token = createTrustedBackendRequestToken({
    user: { sub: 'platform-admin-1', role: 'ADMIN', tenantId: null },
    targetTenantId: 'tenant-selected-7',
    method: 'GET',
    path: '/api/tenant/branches',
    permission: 'tenant.branches.read',
    requestId: 'branch-test-1'
  }, config);
  const claims = jwt.verify(token, testSecrets.gateway, {
    algorithms: ['HS256'],
    issuer: 'ashvin-pharmacy',
    audience: 'pharma-backend-trusted',
    subject: 'api-gateway'
  });
  assert.equal(claims.tenantId, 'tenant-selected-7');
  assert.equal(claims.role, 'ADMIN');
});

test('gateway CORS preflight allows selected tenant and branch headers', async () => {
  const app = createGatewayApp(loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://127.0.0.1:8090',
    CORS_ALLOWED_ORIGINS: 'https://pharma-ui.onrender.com'
  }));
  const server = await start(app);
  try {
    const response = await fetch(`${server.url}/api/tenant/branches`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://pharma-ui.onrender.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-tenant-id,x-branch-id,x-pharma-client'
      }
    });
    assert.equal(response.status, 204);
    const allowed = response.headers.get('access-control-allow-headers') || '';
    assert.match(allowed.toLowerCase(), /x-tenant-id/);
    assert.match(allowed.toLowerCase(), /x-branch-id/);
    assert.match(allowed.toLowerCase(), /x-pharma-client/);
  } finally {
    await server.close();
  }
});


test('intelligent order and medicine request fulfilment endpoints are registered with customer permissions', () => {
  assert.equal(resolveGatewayCapability('POST', '/api/orders/fulfillment/preview'), 'orders.create');
  assert.equal(resolveGatewayCapability('POST', '/api/orders/fulfillment/waitlist'), 'orders.create');
  assert.equal(resolveGatewayCapability('GET', '/api/orders/fulfillment/waitlist'), 'orders.read');
  assert.equal(resolveGatewayCapability('POST', '/api/orders/fulfillment/waitlist/fulfillment-case-1/confirm'), 'orders.create');
  assert.equal(resolveGatewayCapability('POST', '/api/orders/fulfillment/from-medicine-request/request-1'), 'medicine_requests.decide');
  assert.equal(resolveGatewayCapability('GET', '/api/medicine-requests/request-1/fulfillment/preview'), 'medicine_requests.decide');
  assert.equal(resolveGatewayCapability('POST', '/api/medicine-requests/request-1/fulfillment/confirm'), 'medicine_requests.decide');
});
