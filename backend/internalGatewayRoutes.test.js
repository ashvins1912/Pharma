import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import express from 'express';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.GATEWAY_AUTH_SECRET = 'test-gateway-secret-that-is-longer-than-thirty-two-characters';
process.env.DEMO_CUSTOMER_ENABLED = 'true';
process.env.DEMO_CUSTOMER_JWT_SECRET = 'test-demo-customer-secret-longer-than-thirty-two-characters';

const [{ default: gatewayRoutes }, { issueDemoCustomerToken }] = await Promise.all([
  import('./routes/internalGatewayRoutes.js'),
  import('./config/demoCustomer.js')
]);

const start = async () => {
  const app = express();
  app.use(express.json());
  app.use('/internal/gateway', gatewayRoutes);
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

const createGatewayToken = (scope = 'identity:verify', claims = {}) => jwt.sign({ scope, ...claims }, process.env.GATEWAY_AUTH_SECRET, {
  algorithm: 'HS256',
  subject: 'api-gateway',
  issuer: 'ashvin-pharmacy',
  audience: 'pharma-backend-auth',
  expiresIn: 30
});

test('internal identity endpoint requires a valid Gateway assertion', async () => {
  const server = await start();
  try {
    const userToken = await issueDemoCustomerToken();
    const response = await fetch(`${server.url}/internal/gateway/authenticate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test('internal identity endpoint returns only a verified user principal', async () => {
  const server = await start();
  try {
    const userToken = await issueDemoCustomerToken();
    const response = await fetch(`${server.url}/internal/gateway/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'X-Gateway-Authorization': `Bearer ${createGatewayToken()}`
      }
    });
    assert.equal(response.status, 200);
    const { user } = await response.json();
    assert.equal(user.sub, 'demo-customer');
    assert.equal(user.app_metadata.role, 'customer');
    assert.deepEqual(Object.keys(user).sort(), ['aal', 'app_metadata', 'email', 'sub', 'user_metadata']);
  } finally {
    await server.close();
  }
});

test('internal identity endpoint rejects a valid Gateway token with the wrong scope', async () => {
  const server = await start();
  try {
    const userToken = await issueDemoCustomerToken();
    const response = await fetch(`${server.url}/internal/gateway/authenticate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'X-Gateway-Authorization': `Bearer ${createGatewayToken('orders.create')}`
      }
    });
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});


test('internal tenant scope endpoint verifies active tenant branch and tenant-wide membership', async () => {
  const server = await start();
  try {
    const assertion = createGatewayToken('tenant:branch:verify', {
      userId: 'demo-admin-id',
      role: 'TENANT_OWNER',
      tenantId: 'tenant-ashvin-main',
      branchId: 'branch-indore-central'
    });
    const response = await fetch(`${server.url}/internal/gateway/validate-tenant-branch`, {
      method: 'POST',
      headers: { 'X-Gateway-Authorization': `Bearer ${assertion}` }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      valid: true,
      tenantId: 'tenant-ashvin-main',
      branchId: 'branch-indore-central'
    });
  } finally {
    await server.close();
  }
});

test('internal tenant scope endpoint rejects a branch belonging to another tenant', async () => {
  const server = await start();
  try {
    const assertion = createGatewayToken('tenant:branch:verify', {
      userId: 'demo-admin-id',
      role: 'TENANT_OWNER',
      tenantId: 'tenant-ashvin-main',
      branchId: 'branch-bhopal-mpnagar'
    });
    const response = await fetch(`${server.url}/internal/gateway/validate-tenant-branch`, {
      method: 'POST',
      headers: { 'X-Gateway-Authorization': `Bearer ${assertion}` }
    });
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test('internal tenant scope endpoint rejects users without active tenant membership', async () => {
  const server = await start();
  try {
    const assertion = createGatewayToken('tenant:branch:verify', {
      userId: 'unassigned-user',
      role: 'TENANT_ADMIN',
      tenantId: 'tenant-ashvin-main',
      branchId: 'branch-indore-central'
    });
    const response = await fetch(`${server.url}/internal/gateway/validate-tenant-branch`, {
      method: 'POST',
      headers: { 'X-Gateway-Authorization': `Bearer ${assertion}` }
    });
    assert.equal(response.status, 403);
  } finally {
    await server.close();
  }
});
