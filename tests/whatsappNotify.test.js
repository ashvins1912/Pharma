import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { SignJWT } from 'jose';
import orderRoutes from '../backend/routes/orderRoutes.js';
import dataStore from '../backend/dataStore.js';

const JWT_SECRET = process.env.DEMO_ADMIN_JWT_SECRET
    || process.env.ENCRYPTION_SECRET_KEY
    || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SIGNING_KEY = new TextEncoder().encode(JWT_SECRET);

async function createTestToken(payload) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(SIGNING_KEY);
}

test('WhatsApp Notification GET and POST API endpoints for orders', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRoutes);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const adminToken = await createTestToken({
    sub: 'admin-test-uid',
    email: 'admin@ashvin.com',
    app_metadata: { role: 'admin' },
    role: 'admin'
  });

  const authHeaders = {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  };

  try {
    // Retrieve existing in-memory order
    const order = await dataStore.getOrderById('ord-1021');
    assert.ok(order, 'ord-1021 should exist');

    // Add rider to ord-1021
    order.rider = {
      riderId: 'rider-001',
      riderName: 'Vikram Singh',
      riderMobile: '+91 98260 11223'
    };

    // 1. Test GET /api/orders/:id/notify-whatsapp
    const resGet = await fetch(`${baseUrl}/api/orders/ord-1021/notify-whatsapp?target=all`, {
      headers: authHeaders
    });
    assert.strictEqual(resGet.status, 200);
    const dataGet = await resGet.json();
    assert.strictEqual(dataGet.success, true);
    assert.strictEqual(dataGet.orderId, 'ord-1021');
    assert.ok(dataGet.message.includes('WhatsApp'));

    // 2. Test POST /api/orders/:id/notify-whatsapp with specific target
    const resPost = await fetch(`${baseUrl}/api/orders/ord-1021/notify-whatsapp`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ target: 'rider' })
    });
    assert.strictEqual(resPost.status, 200);
    const dataPost = await resPost.json();
    assert.strictEqual(dataPost.success, true);
    assert.strictEqual(dataPost.orderId, 'ord-1021');

    // 3. Test 404 for non-existent order
    const res404 = await fetch(`${baseUrl}/api/orders/non-existent-order-999/notify-whatsapp`, {
      headers: authHeaders
    });
    assert.strictEqual(res404.status, 404);

  } finally {
    server.close();
  }
});
