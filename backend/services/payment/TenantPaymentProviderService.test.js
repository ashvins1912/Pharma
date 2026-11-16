import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptProviderCredentials, decryptProviderCredentials, validateProviderCredentials } from './TenantPaymentProviderService.js';

test('provider credentials are authenticated-encrypted and round-trip', () => {
  const prior=process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY='11'.repeat(32);
  try {
    const input={keyId:'rzp_test_123456',keySecret:'secret_value_123',webhookSecret:'webhook_secret_123'};
    const encrypted=encryptProviderCredentials(input);
    assert.equal(JSON.stringify(encrypted).includes('secret_value_123'),false);
    assert.deepEqual(decryptProviderCredentials(encrypted),input);
    assert.throws(()=>decryptProviderCredentials({...encrypted,credentialTag:Buffer.alloc(16).toString('base64')}));
  } finally { if(prior===undefined) delete process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY; else process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY=prior; }
});

test('provider credential validation requires provider-specific secret fields',()=>{
  assert.deepEqual(validateProviderCredentials('razorpay',{keyId:'rzp_test_123',keySecret:'secret_123',webhookSecret:'hook_secret_123'}),{keyId:'rzp_test_123',keySecret:'secret_123',webhookSecret:'hook_secret_123'});
  assert.throws(()=>validateProviderCredentials('cashfree',{clientId:'client_123',clientSecret:'secret_123'}),{code:'INVALID_CREDENTIALS'});
  assert.throws(()=>validateProviderCredentials('unknown',{secret:'x'}),{code:'UNSUPPORTED_PAYMENT_PROVIDER'});
});
