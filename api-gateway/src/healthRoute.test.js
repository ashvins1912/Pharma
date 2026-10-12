import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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

test('service health summary requires authenticated administrator authorization', async () => {
  const backend = createServer((req, res) => {
    if (req.url !== '/internal/gateway/authenticate') {
      res.writeHead(404).end();
      return;
    }
    const role = req.headers.authorization === 'Bearer admin-token' ? 'admin' : 'customer';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user: { sub: 'user-1', app_metadata: { role } } }));
  });
  backend.listen(0, '127.0.0.1');
  await new Promise(resolve => backend.once('listening', resolve));
  const config = loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: `http://127.0.0.1:${backend.address().port}`,
    GATEWAY_AUTH_SECRET: 'test-gateway-secret-that-is-longer-than-thirty-two-characters',
    SERVICE_AUTH_SECRET: 'test-service-secret-that-is-longer-than-thirty-two-characters',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
  });
  const degradedSnapshot = {
    overallStatus: 'DEGRADED',
    checkedAt: '2026-10-03T00:00:00Z',
    services: [
      { serviceName: 'backend-api', status: 'HEALTHY', checkedAt: '2026-10-03T00:00:00Z', responseTimeMs: 12 },
      { serviceName: 'inventory-service', status: 'UNHEALTHY', checkedAt: '2026-10-03T00:00:00Z', responseTimeMs: 40, errorMessage: 'private endpoint detail' },
      { serviceName: 'order-service', status: 'HEALTHY', checkedAt: '2026-10-03T00:00:00Z', responseTimeMs: 18 }
    ]
  };
  let healthCheckCalls = 0;
  const monitor = {
    snapshot: () => degradedSnapshot,
    checkNow: async () => {
      healthCheckCalls += 1;
      return healthCheckCalls === 1
        ? degradedSnapshot
        : { ...degradedSnapshot, overallStatus: 'HEALTHY' };
    }
  };
  const gateway = await start(createGatewayApp(config, monitor));
  try {
    const publicHealthResponse = await fetch(`${gateway.url}/health`);
    assert.equal(publicHealthResponse.status, 503);
    const publicHealth = await publicHealthResponse.json();
    assert.equal(publicHealth.overallStatus, 'DEGRADED');
    assert.equal(publicHealth.serviceCount, 3);
    assert.deepEqual(publicHealth.services.map(service => service.name), ['backend-api', 'inventory-service', 'order-service']);
    assert.equal(publicHealth.services[1].status, 'UNHEALTHY');
    assert.equal(JSON.stringify(publicHealth).includes('private endpoint detail'), false);
    assert.equal(healthCheckCalls, 1);

    const secondPublicHealthResponse = await fetch(`${gateway.url}/health`);
    assert.equal(secondPublicHealthResponse.status, 200);
    assert.equal((await secondPublicHealthResponse.json()).overallStatus, 'HEALTHY');
    assert.equal(healthCheckCalls, 2);

    const versionedHealthResponse = await fetch(`${gateway.url}/api/v1/health`);
    assert.equal(versionedHealthResponse.status, 200);
    assert.equal((await versionedHealthResponse.json()).overallStatus, 'HEALTHY');
    assert.equal(healthCheckCalls, 3);

    const unauthenticated = await fetch(`${gateway.url}/health/services`);
    assert.equal(unauthenticated.status, 401);
    const customer = await fetch(`${gateway.url}/health/services`, { headers: { Authorization: 'Bearer customer-token' } });
    assert.equal(customer.status, 403);
    const admin = await fetch(`${gateway.url}/health/services`, { headers: { Authorization: 'Bearer admin-token' } });
    assert.equal(admin.status, 200);
    assert.equal((await admin.json()).overallStatus, 'DEGRADED');
  } finally {
    await gateway.close();
    await new Promise(resolve => backend.close(resolve));
  }
});
