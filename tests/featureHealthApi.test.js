/**
 * Feature Health API contract tests.
 * The audit uses the production router and signed platform/tenant sessions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import gatewayRouter from '../backend/gateway/gatewayRouter.js';

const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
  || process.env.ENCRYPTION_SECRET_KEY
  || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

async function createTestToken(role, tenantId = null) {
  return new SignJWT({
    sub: `feature-health-${role.toLowerCase()}-test`,
    email: `${role.toLowerCase()}@test.invalid`,
    app_metadata: { role, tenantId }
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(SIGNING_KEY);
}

async function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', gatewayRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/api/v1`,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

test('Feature Health API exposes a complete report through run-audit and GET cache', async () => {
  const server = await createTestServer();
  try {
    const token = await createTestToken('SUPER_ADMIN');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const auditResponse = await fetch(`${server.baseUrl}/admin/feature-health/run-audit`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30000)
    });
    assert.equal(auditResponse.status, 200, 'run-audit must be a registered and callable endpoint');

    const audit = await auditResponse.json();
    assert.equal(audit.success, true);
    assert.equal(audit.data.summary.totalRbacChecks, 63);
    assert.equal(audit.data.matrix.roles.length, 9);
    assert.equal(audit.data.matrix.features.length, 7);
    assert.ok(Array.isArray(audit.data.services));
    assert.ok(Array.isArray(audit.data.blockers));
    assert.equal(typeof audit.data.healthScore, 'number');

    const cachedResponse = await fetch(`${server.baseUrl}/admin/feature-health?fresh=false`, { headers });
    assert.equal(cachedResponse.status, 200);
    const cached = await cachedResponse.json();
    assert.equal(cached.success, true);
    assert.equal(cached.data.summary.totalRbacChecks, 63);
    assert.equal(cached.data.services.length, audit.data.services.length);
  } finally {
    await server.close();
  }
});

test('Feature Health API remains restricted to platform Super Admin', async () => {
  const server = await createTestServer();
  try {
    const tenantToken = await createTestToken('TENANT_ADMIN', 'tenant-test-a');
    const response = await fetch(`${server.baseUrl}/admin/feature-health/run-audit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' }
    });
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});
