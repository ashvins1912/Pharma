import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from './config.js';

const secrets = {
  gateway: 'test-gateway-secret-that-is-longer-than-thirty-two-characters',
  service: 'test-service-secret-that-is-longer-than-thirty-two-characters'
};

test('production Gateway requires exact HTTPS origins and the identity secret', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    BACKEND_API_URL: 'https://backend.example.com',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com'
  }), /GATEWAY_AUTH_SECRET/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    BACKEND_API_URL: 'https://backend.example.com',
    GATEWAY_AUTH_SECRET: secrets.gateway,
    CORS_ALLOWED_ORIGINS: 'http://app.example.com'
  }), /HTTPS/);
  assert.doesNotThrow(() => loadConfig({
    NODE_ENV: 'production',
    BACKEND_API_URL: 'https://backend.example.com',
    GATEWAY_AUTH_SECRET: secrets.gateway,
    CORS_ALLOWED_ORIGINS: 'https://app.example.com'
  }));
});

test('service routing requires service and Gateway signing secrets', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://backend.example.com',
    ORDER_SERVICE_URL: 'http://order.example.com',
    CORS_ALLOWED_ORIGINS: 'http://app.example.com'
  }), /SERVICE_AUTH_SECRET/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://backend.example.com',
    ORDER_SERVICE_URL: 'http://order.example.com',
    SERVICE_AUTH_SECRET: secrets.service,
    CORS_ALLOWED_ORIGINS: 'http://app.example.com'
  }), /GATEWAY_AUTH_SECRET/);
});

test('backend and service URLs must be origins without paths or credentials', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://backend.example.com/private',
    CORS_ALLOWED_ORIGINS: 'http://app.example.com'
  }), /BACKEND_API_URL/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://backend.example.com',
    ORDER_SERVICE_URL: 'http://user:password@order.example.com',
    SERVICE_AUTH_SECRET: secrets.service,
    GATEWAY_AUTH_SECRET: secrets.gateway,
    CORS_ALLOWED_ORIGINS: 'http://app.example.com'
  }), /ORDER_SERVICE_URL/);
});

test('development defaults allow the frontend origin when opened at the bind address', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    BACKEND_API_URL: 'http://localhost:8090'
  });

  assert.ok(config.allowedOrigins.includes('http://0.0.0.0:3000'));
});
