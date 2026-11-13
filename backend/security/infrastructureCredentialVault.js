import crypto from 'node:crypto';
import mongoose from 'mongoose';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';
const COLLECTION = 'infrastructure_integrations';
const AUDIT_COLLECTION = 'infrastructure_security_audit';

const integrationSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 120 },
  provider: { type: String, required: true, match: /^[a-z][a-z0-9_-]{0,63}$/ },
  environment: { type: String, enum: ['development', 'staging', 'production'], required: true },
  authMethod: { type: String, required: true, maxlength: 40 },
  endpoint: { type: String, maxlength: 500, default: null },
  secretEnvelope: {
    algorithm: { type: String, required: true },
    keyVersion: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    ciphertext: { type: String, required: true }
  },
  requestedScopes: { type: [String], default: [] },
  grantedScopes: { type: [String], default: [] },
  requestedCapabilities: { type: [String], default: ['read', 'monitor'] },
  state: { type: String, default: 'PENDING_VERIFICATION' },
  complianceState: { type: String, default: 'NOT_ASSESSED' },
  verification: { type: mongoose.Schema.Types.Mixed, default: null },
  policyEvidence: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, required: true },
  lastVerifiedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  secretRotatedAt: { type: Date, default: null }
}, { timestamps: true, minimize: false, strict: true });
integrationSchema.index({ provider: 1, environment: 1, createdAt: -1 });
const auditSchema = new mongoose.Schema({
  integrationId: { type: String, required: true, index: true },
  actor: { type: String, required: true },
  event: { type: String, required: true },
  outcome: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  requestId: { type: String, default: null },
  occurredAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false, strict: true });
auditSchema.index({ occurredAt: -1 });
const Integration = mongoose.models.InfrastructureIntegration || mongoose.model('InfrastructureIntegration', integrationSchema, COLLECTION);
const Audit = mongoose.models.InfrastructureSecurityAudit || mongoose.model('InfrastructureSecurityAudit', auditSchema, AUDIT_COLLECTION);

function encryptionKey() {
  const encoded = String(process.env.INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!encoded) throw new Error('Credential vault is locked: configure INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEY.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('Credential vault key must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptCredentialPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { algorithm: ALGORITHM, keyVersion: KEY_VERSION, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptCredentialPayload(envelope) {
  if (!envelope || envelope.algorithm !== ALGORITHM || envelope.keyVersion !== KEY_VERSION) throw new Error('Unsupported credential envelope.');
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const clear = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(clear.toString('utf8'));
}

export function publicIntegration(doc) {
  const item = doc.toObject ? doc.toObject() : doc;
  const { secretEnvelope, __v, ...safe } = item;
  return safe;
}

export async function writeInfrastructureAudit({ integrationId, actor, event, outcome, details = {}, requestId = null }) {
  const safeDetails = { ...details };
  for (const key of Object.keys(safeDetails)) if (/secret|token|password|credential|authorization|private.?key/i.test(key)) safeDetails[key] = '[REDACTED]';
  await Audit.create({ integrationId: String(integrationId), actor: String(actor), event, outcome, details: safeDetails, requestId });
}

export { Integration as InfrastructureIntegration, Audit as InfrastructureSecurityAudit };
