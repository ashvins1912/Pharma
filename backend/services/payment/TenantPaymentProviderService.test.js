import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptProviderCredentials, decryptProviderCredentials, validateProviderCredentials, sanitizeProvider } from './TenantPaymentProviderService.js';

test('provider credential validation is adapter-specific', () => {
  assert.deepEqual(validateProviderCredentials('razorpay', { keyId: 'rzp_test_123', keySecret: 'secret123', webhookSecret: 'webhook123', extra: 'ignored' }),
    { keyId: 'rzp_test_123', keySecret: 'secret123', webhookSecret: 'webhook123' });
  assert.throws(() => validateProviderCredentials('cashfree', { clientId: '12345678' }), /clientSecret/);
  assert.throws(() => validateProviderCredentials('unknown', {}), /not registered/);
});
test('tenant credentials encrypt with authenticated encryption and never appear in public config', () => {
  const previous = process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const credentials = { keyId: 'rzp_test_123', keySecret: 'secret123' };
    const encrypted = encryptProviderCredentials(credentials);
    assert.ok(!encrypted.credentialCiphertext.includes('secret123'));
    assert.deepEqual(decryptProviderCredentials(encrypted), credentials);
    assert.throws(() => decryptProviderCredentials({ ...encrypted, credentialTag: 'AA'.repeat(16) }));
    const publicConfig = sanitizeProvider({ _id: '123', tenantId: 'tenant-a', provider: 'razorpay', environment: 'sandbox', enabled: true, isDefault: true, ...encrypted });
    assert.ok(!JSON.stringify(publicConfig).includes('credential'));
    assert.ok(!JSON.stringify(publicConfig).includes('secret123'));
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});
