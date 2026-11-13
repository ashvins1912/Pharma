import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
const { encryptCredentialPayload, decryptCredentialPayload, publicIntegration } = await import('../infrastructureCredentialVault.js');

test('credential envelope encrypts and decrypts without exposing cleartext', () => {
  const credentials = { accessToken: 'top-secret-token', clientId: 'service-client' };
  const envelope = encryptCredentialPayload(credentials);
  assert.equal(envelope.algorithm, 'aes-256-gcm');
  assert.equal(JSON.stringify(envelope).includes(credentials.accessToken), false);
  assert.deepEqual(decryptCredentialPayload(envelope), credentials);
});

test('credential envelope rejects tampering', () => {
  const envelope = encryptCredentialPayload({ password: 'secret' });
  envelope.ciphertext = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptCredentialPayload(envelope));
});

test('public integration serializer never returns encrypted credential envelope', () => {
  const safe = publicIntegration({
    _id: 'integration-id', provider: 'example', secretEnvelope: { ciphertext: 'ciphertext' },
    name: 'Example', state: 'PENDING_VERIFICATION'
  });
  assert.equal(safe.secretEnvelope, undefined);
  assert.equal(safe.provider, 'example');
});


test('versioned key ring decrypts older envelopes after active key rotation', () => {
  const oldKey = crypto.randomBytes(32).toString('base64');
  const newKey = crypto.randomBytes(32).toString('base64');
  delete process.env.INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEY;
  process.env.INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEYS = JSON.stringify({ activeVersion: 'v1', keys: { v1: oldKey } });
  const oldEnvelope = encryptCredentialPayload({ token: 'old-secret' });
  process.env.INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEYS = JSON.stringify({ activeVersion: 'v2', keys: { v1: oldKey, v2: newKey } });
  const newEnvelope = encryptCredentialPayload({ token: 'new-secret' });
  assert.equal(oldEnvelope.keyVersion, 'v1');
  assert.equal(newEnvelope.keyVersion, 'v2');
  assert.deepEqual(decryptCredentialPayload(oldEnvelope), { token: 'old-secret' });
  assert.deepEqual(decryptCredentialPayload(newEnvelope), { token: 'new-secret' });
});
