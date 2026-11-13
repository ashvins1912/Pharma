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
