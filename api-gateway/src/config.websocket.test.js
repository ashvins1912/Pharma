import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('gateway registers standalone websocket health endpoint when configured', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://127.0.0.1:8090',
    WEBSOCKET_SERVICE_URL: 'http://127.0.0.1:4100',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173'
  });
  const websocket = config.healthServices.find(service => service.name === 'websocket-service');
  assert.deepEqual(websocket, {
    name: 'websocket-service',
    baseUrl: 'http://127.0.0.1:4100',
    healthPath: '/healthz',
    critical: false
  });
});

test('gateway does not register websocket health check when URL is omitted', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://127.0.0.1:8090',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173'
  });
  assert.equal(config.healthServices.some(service => service.name === 'websocket-service'), false);
});
