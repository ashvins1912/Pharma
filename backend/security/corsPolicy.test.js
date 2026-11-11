import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { corsErrorHandler, createCorsMiddleware } from './corsPolicy.js';
import { requestContext } from './requestContext.js';

const createTestServer = async () => {
  const app = express();
  app.use(requestContext);
  app.use(createCorsMiddleware(['https://app.example.com']));
  app.get('/api/v1/orders', (_req, res) => res.json({ success: true }));
  app.use(corsErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
};

test('allows configured credentialed origins and CORS preflight before authentication', async () => {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.origin}/api/v1/orders`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key,x-correlation-id'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.match(response.headers.get('access-control-allow-headers'), /idempotency-key/i);
  } finally {
    await server.close();
  }
});

test('returns a controlled CORS error with request ID for a rejected origin', async () => {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.origin}/api/v1/orders`, {
      headers: {
        Origin: 'https://untrusted.example',
        'X-Request-ID': 'cors-test-request'
      }
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('x-request-id'), 'cors-test-request');
    assert.deepEqual(await response.json(), {
      success: false,
      error: {
        code: 'CORS_ORIGIN_NOT_ALLOWED',
        message: 'Request origin is not allowed.'
      },
      requestId: 'cors-test-request'
    });
  } finally {
    await server.close();
  }
});

test('allows requests without an Origin header', async () => {
  const server = await createTestServer();
  try {
    const response = await fetch(`${server.origin}/api/v1/orders`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await server.close();
  }
});
