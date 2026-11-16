import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import TenantPaymentProvider from '../../models/TenantPaymentProvider.js';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const supported = new Set(['razorpay', 'cashfree', 'payu']);
const fields = {
  razorpay: ['keyId', 'keySecret', 'webhookSecret'],
  cashfree: ['clientId', 'clientSecret', 'webhookSecret'],
  payu: ['merchantKey', 'merchantSalt']
};
const normalize = (value, name) => {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(result)) throw fail(400, 'INVALID_' + name.toUpperCase(), 'Invalid ' + name);
  return result;
};
const key = () => {
  const raw = process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw)) throw fail(503, 'PAYMENT_ENCRYPTION_UNAVAILABLE', 'Payment credential encryption key must be 32 bytes encoded as hex.');
  return Buffer.from(raw, 'hex');
};
const version = () => process.env.PAYMENT_CREDENTIAL_KEY_VERSION || 'v1';
export function encryptProviderCredentials(credentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return { credentialCiphertext: ciphertext.toString('base64'), credentialIv: iv.toString('base64'),
    credentialTag: cipher.getAuthTag().toString('base64'), credentialKeyVersion: version() };
}
export function decryptProviderCredentials(record) {
  if (record.credentialKeyVersion !== version()) throw fail(503, 'PAYMENT_KEY_VERSION_UNAVAILABLE', 'Credential encryption key version is unavailable.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(record.credentialIv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.credentialTag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.credentialCiphertext, 'base64')), decipher.final()]).toString('utf8'));
}
export function validateProviderCredentials(provider, credentials) {
  const name = normalize(provider, 'provider');
  if (!supported.has(name)) throw fail(400, 'UNSUPPORTED_PAYMENT_PROVIDER', 'Provider adapter is not registered.');
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw fail(400, 'INVALID_CREDENTIALS', 'Credentials must be an object.');
  for (const field of fields[name]) {
    if (typeof credentials[field] !== 'string' || credentials[field].trim().length < 8) {
      throw fail(400, 'INVALID_CREDENTIALS', 'Missing or invalid required provider credential: ' + field);
    }
  }
  return Object.fromEntries(fields[name].map(field => [field, credentials[field].trim()]));
}
export async function configureTenantPaymentProvider({ tenantId, provider, environment = 'sandbox', credentials, actorId }) {
  const tenant = String(tenantId || '').trim();
  if (!tenant || tenant.length > 128) throw fail(400, 'INVALID_TENANT', 'Tenant is required.');
  const name = normalize(provider, 'provider');
  if (!['sandbox', 'production'].includes(environment)) throw fail(400, 'INVALID_ENVIRONMENT', 'Unsupported payment environment.');
  const encrypted = encryptProviderCredentials(validateProviderCredentials(name, credentials));
  const record = await TenantPaymentProvider.findOneAndUpdate(
    { tenantId: tenant, provider: name, environment },
    { $set: { ...encrypted, credentialUpdatedAt: new Date(), updatedBy: actorId || null },
      $setOnInsert: { enabled: false, isDefault: false, createdBy: actorId || null } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  return sanitizeProvider(record);
}
export function sanitizeProvider(record) {
  const data = record.toObject ? record.toObject() : record;
  return { id: String(data._id), tenantId: data.tenantId, provider: data.provider, environment: data.environment,
    enabled: data.enabled, isDefault: data.isDefault, credentialUpdatedAt: data.credentialUpdatedAt };
}
export async function listTenantPaymentProviders(tenantId) {
  const records = await TenantPaymentProvider.find({ tenantId: String(tenantId) }).lean();
  return records.map(sanitizeProvider);
}
export async function resolveTenantPaymentProvider({ tenantId, environment = 'production' }) {
  const record = await TenantPaymentProvider.findOne({
    tenantId: String(tenantId), environment, enabled: true, isDefault: true
  }).select('+credentialCiphertext +credentialIv +credentialTag +credentialKeyVersion').lean();
  if (!record) throw fail(409, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Tenant has no enabled default payment provider.');
  return { provider: record.provider, environment: record.environment, credentials: decryptProviderCredentials(record) };
}
export async function selectDefaultTenantPaymentProvider({ tenantId, provider, environment = 'production' }) {
  const tenant = String(tenantId || '').trim();
  const name = normalize(provider, 'provider');
  if (!tenant) throw fail(400, 'INVALID_TENANT', 'Tenant is required.');
  const mongoose = (await import('mongoose')).default;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const target = await TenantPaymentProvider.findOne({ tenantId: tenant, provider: name, environment }).session(session);
      if (!target) throw fail(404, 'PAYMENT_PROVIDER_NOT_FOUND', 'Configure provider credentials first.');
      await TenantPaymentProvider.updateMany({ tenantId: tenant, environment, isDefault: true },
        { $set: { isDefault: false } }, { session });
      await TenantPaymentProvider.updateOne({ _id: target._id, tenantId: tenant },
        { $set: { enabled: true, isDefault: true } }, { session });
    });
  } finally { await session.endSession(); }
  return { tenantId: tenant, provider: name, environment, enabled: true, isDefault: true };
}
