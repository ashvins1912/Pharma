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
  targetConfig: { type: mongoose.Schema.Types.Mixed, default: {}, select: true },
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
  integrationId: { type: String, required: true, index: true, immutable: true },
  actor: { type: String, required: true, immutable: true },
  event: { type: String, required: true, immutable: true },
  outcome: { type: String, required: true, immutable: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  requestId: { type: String, default: null, immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false, strict: true });
auditSchema.index({ occurredAt: -1 });
const Integration = mongoose.models.InfrastructureIntegration || mongoose.model('InfrastructureIntegration', integrationSchema, COLLECTION);
const Audit = mongoose.models.InfrastructureSecurityAudit || mongoose.model('InfrastructureSecurityAudit', auditSchema, AUDIT_COLLECTION);

function encryptionKey(version = null) {
  const rawRing = String(process.env.INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEYS || '').trim();
  if (rawRing) {
    let ring;
    try { ring = JSON.parse(rawRing); } catch { throw new Error('Credential key ring must be valid JSON.'); }
    const activeVersion = String(ring.activeVersion || '');
    const selectedVersion = version || activeVersion;
    const encoded = ring.keys?.[selectedVersion];
    if (!selectedVersion || !encoded) throw new Error(`Credential encryption key version ${selectedVersion || '(missing)'} is unavailable.`);
    const key = Buffer.from(String(encoded), 'base64');
    if (key.length !== 32) throw new Error(`Credential encryption key ${selectedVersion} must decode to 32 bytes.`);
    return { key, version: selectedVersion };
  }
  if (version && version !== KEY_VERSION) throw new Error(`Legacy credential key cannot decrypt version ${version}.`);
  const encoded = String(process.env.INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!encoded) throw new Error('Credential vault is locked: configure INFRASTRUCTURE_CREDENTIAL_ENCRYPTION_KEYS.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('Credential vault key must be a base64-encoded 32-byte key.');
  return { key, version: KEY_VERSION };
}

export function encryptCredentialPayload(payload) {
  const iv = crypto.randomBytes(12);
  const active = encryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, active.key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { algorithm: ALGORITHM, keyVersion: active.version, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptCredentialPayload(envelope) {
  if (!envelope || envelope.algorithm !== ALGORITHM || typeof envelope.keyVersion !== 'string' || !envelope.keyVersion) throw new Error('Unsupported credential envelope.');
  const selected = encryptionKey(envelope.keyVersion);
  const decipher = crypto.createDecipheriv(ALGORITHM, selected.key, Buffer.from(envelope.iv, 'base64'));
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


const TARGET_FIELDS = Object.freeze({
  aws: ['region','clusterArn','executionRoleArn','subnetIds','securityGroupIds','assignPublicIp','desiredCount','stateBackend'],
  azure: ['tenantId','subscriptionId','resourceGroupName','location','containerAppEnvironmentId','stateBackend'],
  gcp: ['projectId','region','stateBackend'],
  kubernetes: ['namespace','contextName','allowedDeploymentNames'],
  launchdarkly: ['projectKey','environmentKey']
});
export function validateProviderTargetConfig(provider, input = {}) {
  if (!['aws','azure','gcp','kubernetes','launchdarkly'].includes(provider)) throw new Error('Provider does not support managed deployment targets.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provider target configuration must be an object.');
  const allowed = new Set(TARGET_FIELDS[provider]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error('Unsupported '+provider+' target configuration field: '+key);
  const value = structuredClone(input);
  const required = {
    aws: ['region','clusterArn','executionRoleArn','subnetIds','securityGroupIds','stateBackend'],
    azure: ['tenantId','subscriptionId','resourceGroupName','location','containerAppEnvironmentId','stateBackend'],
    gcp: ['projectId','region','stateBackend'],
    kubernetes: ['namespace'],
    launchdarkly: ['projectKey','environmentKey']
  }[provider];
  if (Object.keys(value).length && required.some(key => value[key] === undefined || value[key] === null || value[key] === '')) throw new Error(provider+' target configuration is missing required fields: '+required.filter(key => value[key] === undefined || value[key] === null || value[key] === '').join(', '));
  if (provider === 'aws' && Object.keys(value).length) {
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value.region)) throw new Error('AWS target region is invalid.');
    if (!Array.isArray(value.subnetIds) || !value.subnetIds.length || !Array.isArray(value.securityGroupIds) || !value.securityGroupIds.length) throw new Error('AWS subnet and security-group allowlists are required.');
    if (!/^arn:aws(?:-us-gov)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/.test(value.executionRoleArn)) throw new Error('AWS execution role ARN is invalid.');
  }
  if (provider === 'azure' && Object.keys(value).length && (!/^[0-9a-f-]{36}$/i.test(value.tenantId) || !/^[0-9a-f-]{36}$/i.test(value.subscriptionId))) throw new Error('Azure tenant and subscription IDs must be UUIDs.');
  if (provider === 'gcp' && Object.keys(value).length && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value.projectId)) throw new Error('GCP project ID is invalid.');
  if (provider === 'kubernetes' && Object.keys(value).length && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value.namespace)) throw new Error('Kubernetes namespace must be DNS-safe.');
  if (provider === 'launchdarkly' && Object.keys(value).length && (!/^[a-zA-Z0-9_-]{1,64}$/.test(value.projectKey) || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.environmentKey))) throw new Error('LaunchDarkly project and environment keys are invalid.');
  if (['aws','azure','gcp'].includes(provider) && Object.keys(value).length) {
    const backend = value.stateBackend;
    if (!backend || typeof backend !== 'object' || Array.isArray(backend) || !['s3','azurerm','gcs'].includes(backend.type)) throw new Error('A supported remote Terraform state backend is required.');
    const backendFields = {s3:['bucket','key','region'],azurerm:['resourceGroupName','storageAccountName','containerName','key'],gcs:['bucket','prefix']}[backend.type];
    const backendAllowed = new Set(['type', ...backendFields]);
    if (Object.keys(backend).some(key => !backendAllowed.has(key))) throw new Error('Unsupported Terraform state backend field.');
    if (backendFields.some(key => typeof backend[key] !== 'string' || !backend[key].trim() || backend[key].length > 200 || /[\\r\\n]/.test(backend[key]))) throw new Error('Terraform remote state backend configuration is incomplete or invalid.');
    if ((provider === 'aws' && backend.type !== 's3') || (provider === 'azure' && backend.type !== 'azurerm') || (provider === 'gcp' && backend.type !== 'gcs')) throw new Error('Terraform state backend type does not match the cloud provider.');
  }
  return value;
}

export { Integration as InfrastructureIntegration, Audit as InfrastructureSecurityAudit };

