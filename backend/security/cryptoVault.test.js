import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptPII, decryptPII } from './cryptoVault.js';

test('AES-256-GCM vault round-trips strings and JSON values', () => {
  const secret = 'mfa-seed-value';
  const encrypted = encryptPII(secret);
  assert.match(encrypted, /^aes-256-gcm:/);
  assert.equal(decryptPII(encrypted), secret);
  const object = { recoveryCodes: ['one', 'two'] };
  assert.deepEqual(decryptPII(encryptPII(object)), object);
});

test('AES-256-GCM vault rejects modified ciphertext', () => {
  const encrypted = encryptPII('confidential');
  const altered = encrypted.slice(0, -1) + (encrypted.endsWith('0') ? '1' : '0');
  assert.equal(decryptPII(altered), '[TAMPERED_OR_CORRUPT_PII]');
});

test('AES-256-GCM vault preserves null values', () => {
  assert.equal(encryptPII(null), null);
  assert.equal(decryptPII(null), null);
});
