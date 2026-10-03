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

const createGatewayToken = (scope = 'identity:verify') => jwt.sign({ scope }, process.env.GATEWAY_AUTH_SECRET, {
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
