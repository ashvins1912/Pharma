import assert from 'node:assert/strict';
import test from 'node:test';
import { envSchema } from './env.js';

test('production environment requires a dedicated encryption key', () => {
  const result = envSchema.safeParse({ NODE_ENV: 'production' });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.path.join('.') === 'ENCRYPTION_SECRET_KEY'));
});

test('production environment rejects demo/default encryption keys', () => {
  const result = envSchema.safeParse({
    NODE_ENV: 'production',
    ENCRYPTION_SECRET_KEY: 'ashvin-pharmacy-zero-cost-pii-encryption-key-32chars!'
  });
  assert.equal(result.success, false);
});

test('production environment accepts a dedicated high-entropy-length key', () => {
  const result = envSchema.safeParse({ NODE_ENV: 'production', ENCRYPTION_SECRET_KEY: 'a'.repeat(48) });
  assert.equal(result.success, true);
});
