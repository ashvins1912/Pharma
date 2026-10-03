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
  const monitor = { snapshot: () => ({ overallStatus: 'HEALTHY', checkedAt: '2026-10-03T00:00:00Z', services: [{ serviceName: 'backend-api', status: 'HEALTHY' }] }) };
  const gateway = await start(createGatewayApp(config, monitor));
  try {
    const unauthenticated = await fetch(`${gateway.url}/health/services`);
    assert.equal(unauthenticated.status, 401);
    const customer = await fetch(`${gateway.url}/health/services`, { headers: { Authorization: 'Bearer customer-token' } });
    assert.equal(customer.status, 403);
    const admin = await fetch(`${gateway.url}/health/services`, { headers: { Authorization: 'Bearer admin-token' } });
    assert.equal(admin.status, 200);
    assert.equal((await admin.json()).overallStatus, 'HEALTHY');
  } finally {
    await gateway.close();
    await new Promise(resolve => backend.close(resolve));
  }
});
