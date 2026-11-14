import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import {
  InfrastructureIntegration,
  decryptCredentialPayload,
  writeInfrastructureAudit
} from '../../security/infrastructureCredentialVault.js';
import {
  DEPLOYMENT_STRATEGIES,
  generateDeploymentFiles,
  validateGeneratedArtifact
} from '../../services/devopsDeploymentKit.js';

const router = express.Router();
router.use(authenticateUser, requireSuperAdmin);

const artifactSchema = new mongoose.Schema({
  serviceName: { type: String, required: true, index: true },
  environment: { type: String, enum: ['development', 'staging', 'production'], required: true, index: true },
  provider: { type: String, required: true },
  generatorVersion: { type: String, default: '1.0.0' },
  config: { type: mongoose.Schema.Types.Mixed, required: true },
  files: [{ path: { type: String, required: true }, content: { type: String, required: true } }],
  digest: { type: String, required: true, index: true },
  validation: { status: { type: String, enum: ['PENDING', 'PASS', 'FAIL'], default: 'PENDING' }, errors: { type: [String], default: [] }, checkedAt: Date },
  createdBy: { type: String, required: true }
}, { timestamps: true, strict: true });
artifactSchema.index({ serviceName: 1, environment: 1, createdAt: -1 });
const Artifact = mongoose.models.DevOpsArtifact || mongoose.model('DevOpsArtifact', artifactSchema, 'devops_artifacts');

const providerPreflightSchema = new mongoose.Schema({
  provider: { type: String, enum: ['aws','azure','gcp','kubernetes','launchdarkly'], required: true, index: true },
  environment: { type: String, enum: ['staging'], required: true, default: 'staging' },
  integrationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  artifactId: { type: mongoose.Schema.Types.ObjectId, default: null },
  artifactDigest: { type: String, default: null, index: true },
  targetDigest: { type: String, required: true },
  serviceName: { type: String, default: null },
  flagKey: { type: String, default: null },
  status: { type: String, enum: ['PASS','FAIL','BLOCKED'], required: true, index: true },
  evidenceRunId: { type: String, default: null },
  checkedBy: { type: String, required: true },
  checkedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true, strict: true });
providerPreflightSchema.index({ provider: 1, environment: 1, artifactDigest: 1, flagKey: 1, status: 1, checkedAt: -1 });
const ProviderPreflight = mongoose.models.DevOpsProviderPreflight || mongoose.model('DevOpsProviderPreflight', providerPreflightSchema, 'devops_provider_preflights');

const configurationSchema = new mongoose.Schema({
  serviceName: { type: String, required: true, index: true },
  environment: { type: String, enum: ['development', 'staging', 'production'], required: true, index: true },
  version: { type: Number, required: true },
  values: { type: mongoose.Schema.Types.Mixed, default: {} },
  secretRefs: { type: mongoose.Schema.Types.Mixed, default: {} },
  changeReference: { type: String, default: null },
  createdBy: { type: String, required: true }
}, { timestamps: true, strict: true });
configurationSchema.index({ serviceName: 1, environment: 1, version: -1 }, { unique: true });
const Configuration = mongoose.models.DevOpsConfiguration || mongoose.model('DevOpsConfiguration', configurationSchema, 'devops_configurations');

const deploymentSchema = new mongoose.Schema({
  artifactId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  serviceName: { type: String, required: true, index: true },
  provider: { type: String, required: true },
  environment: { type: String, enum: ['development', 'staging', 'production'], required: true },
  strategy: { type: String, required: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  status: { type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ROLLBACK_REQUESTED', 'ROLLED_BACK'], default: 'PENDING_APPROVAL', index: true },
  requestedBy: { type: String, required: true },
  approvedBy: { type: String, default: null },
  approvedAt: { type: Date, default: null },
  changeReference: { type: String, required: true },
  remoteDeploymentId: { type: String, default: null },
  rollbackRequestId: { type: String, default: null },
  rollbackAvailable: { type: Boolean, default: false },
  remoteStatus: { type: String, default: null },
  lastErrorCode: { type: String, default: null },
  rolloutStages: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true, strict: true });
deploymentSchema.index({ environment: 1, status: 1, createdAt: -1 });
const Deployment = mongoose.models.DevOpsDeployment || mongoose.model('DevOpsDeployment', deploymentSchema, 'devops_deployments');

const flagChangeSchema = new mongoose.Schema({
  flagKey: { type: String, required: true },
  environment: { type: String, enum: ['development', 'staging', 'production'], required: true },
  strategy: { type: String, required: true },
  rolloutPercent: { type: Number, min: 0, max: 100, required: true },
  integrationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestedBy: { type: String, required: true },
  approvedBy: { type: String, default: null },
  approvedAt: { type: Date, default: null },
  changeReference: { type: String, required: true },
  status: { type: String, enum: ['PENDING_APPROVAL', 'APPROVED', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK'], default: 'PENDING_APPROVAL' },
  remoteRequestId: { type: String, default: null },
  remoteStatus: { type: String, default: null }
}, { timestamps: true, strict: true });
flagChangeSchema.index({ environment: 1, status: 1, createdAt: -1 });
const FlagChange = mongoose.models.DevOpsFlagChange || mongoose.model('DevOpsFlagChange', flagChangeSchema, 'devops_flag_changes');

const auditSchema = new mongoose.Schema({
  actor: { type: String, required: true, immutable: true },
  event: { type: String, required: true, immutable: true },
  outcome: { type: String, required: true, immutable: true },
  targetType: { type: String, required: true, immutable: true },
  targetId: { type: String, required: true, immutable: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  requestId: { type: String, default: null, immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false, strict: true });
auditSchema.index({ occurredAt: -1 });
const DevOpsAudit = mongoose.models.DevOpsAudit || mongoose.model('DevOpsAudit', auditSchema, 'devops_audit');

const actorOf = req => String(req.user?.sub || req.user?.id || 'unknown-super-admin');
const targetConfigDigest = value => crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
const requestIdOf = req => req.context?.requestId || req.gatewayRequestId || req.get('x-request-id') || null;
const validId = value => mongoose.Types.ObjectId.isValid(String(value || ''));
const safeName = /^[a-z0-9](?:[a-z0-9-]{0,50}[a-z0-9])?$/;
const safeSecretRef = /^[a-zA-Z0-9][a-zA-Z0-9/_:.-]{0,180}$/;
const allowedConfigKeys = new Set(['NODE_ENV', 'PORT', 'LOG_LEVEL', 'FEATURE_FLAG_ENVIRONMENT', 'CONFIG_VERSION', 'PUBLIC_BASE_URL', 'HEALTH_PATH']);

async function audit(req, event, outcome, targetType, targetId, details = {}) {
  const safe = { ...details };
  for (const key of Object.keys(safe)) if (/secret|token|password|credential|authorization|private.?key/i.test(key)) safe[key] = '[REDACTED]';
  await DevOpsAudit.create({ actor: actorOf(req), event, outcome, targetType, targetId: String(targetId), details: safe, requestId: requestIdOf(req) });
}

function controlPlaneBase() {
  const raw = String(process.env.PRIVATE_DEVOPS_ADAPTER_URL || process.env.INFRASTRUCTURE_CONTROL_PLANE_URL || '').trim();
  if (!raw) throw new Error('Private DevOps control-plane adapter is not configured.');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1','::1'].includes(url.hostname))) throw new Error('DevOps control-plane adapter must use HTTPS; loopback HTTP is permitted only outside production.');
  if (url.username || url.password || url.search || url.hash) throw new Error('DevOps control-plane URL must not contain credentials, query parameters or fragments.');
  return url.toString().replace(/\/$/, '');
}

async function adapterRequest(path, body) {
  const token = String(process.env.PRIVATE_DEVOPS_ADAPTER_TOKEN || process.env.INFRASTRUCTURE_CONTROL_PLANE_TOKEN || '').trim();
  if (token.length < 32) throw new Error('A strong private control-plane service token of at least 32 characters is required.');
  const response = await fetch(new URL(path, controlPlaneBase()), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const raw = await response.text();
  if (raw.length > 512 * 1024) throw new Error('DevOps adapter response exceeded the allowed size.');
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error('DevOps adapter returned invalid JSON.'); }
  if (!response.ok) {
    const error = new Error(`DevOps adapter rejected the request (HTTP ${response.status}).`);
    error.statusCode = response.status;
    error.code = payload.code || 'DEVOPS_ADAPTER_REJECTED';
    throw error;
  }
  return payload;
}

async function getProductionReleaseReadiness() {
  const readiness = await adapterRequest('/v1/release-readiness', {});
  for (const item of readiness.providers || []) {
    const latest = await ProviderPreflight.findOne({ provider: item.provider, environment: 'staging' }).sort({ checkedAt: -1 }).lean();
    const integration = latest ? await InfrastructureIntegration.findOne({ _id: latest.integrationId, revokedAt: null }).lean() : null;
    const targetVerified = Boolean(latest && latest.status === 'PASS' && integration
      && integration.provider === item.provider && integration.environment === 'staging'
      && integration.verification?.authenticated === true
      && integration.verification?.discoveryPassed === true
      && targetConfigDigest(integration.targetConfig) === latest.targetDigest);
    item.targetVerified = targetVerified;
    item.preflight = Boolean(item.preflight && targetVerified);
    item.ready = Boolean(item.preflight && item.deployment && item.rollback);
  }
  readiness.ready = Boolean((readiness.providers || []).length === 5 && readiness.providers.every(item => item.ready));
  return readiness;
}

async function assertDeploymentStagingEvidence(deployment, artifact) {
  if (deployment.environment === 'development' || !['aws','azure','gcp','kubernetes'].includes(deployment.provider)) return;
  const preflight = await ProviderPreflight.findOne({
    provider: deployment.provider, environment: 'staging',
    artifactDigest: artifact.digest, serviceName: artifact.serviceName
  }).sort({ checkedAt: -1 }).lean();
  if (!preflight || preflight.status !== 'PASS') throw Object.assign(new Error('The latest preflight for this exact artifact must pass before approval or execution.'), { code: 'STAGING_PREFLIGHT_REQUIRED', statusCode: 409 });
  const stagedIntegration = await InfrastructureIntegration.findOne({ _id: preflight.integrationId, revokedAt: null }).lean();
  if (!stagedIntegration || stagedIntegration.provider !== deployment.provider || stagedIntegration.environment !== 'staging'
    || stagedIntegration.verification?.authenticated !== true || stagedIntegration.verification?.discoveryPassed !== true
    || targetConfigDigest(stagedIntegration.targetConfig) !== preflight.targetDigest) throw Object.assign(new Error('The preflighted staging target changed or is no longer verified.'), { code: 'STAGING_PREFLIGHT_STALE', statusCode: 409 });
  if (deployment.environment === 'staging' && String(preflight.integrationId) !== String(deployment.integrationId)) throw Object.assign(new Error('The deployment must use the exact staging integration that passed preflight.'), { code: 'STAGING_PREFLIGHT_INTEGRATION_MISMATCH', statusCode: 409 });
  if (deployment.environment === 'production') {
    const stagedDeployment = await Deployment.findOne({
      provider: deployment.provider, environment: 'staging', serviceName: artifact.serviceName,
      integrationId: preflight.integrationId, status: { $in: ['SUCCEEDED','ROLLED_BACK'] }
    }).sort({ updatedAt: -1 }).lean();
    const stagedArtifact = stagedDeployment ? await Artifact.findById(stagedDeployment.artifactId).lean() : null;
    if (!stagedArtifact || stagedArtifact.digest !== artifact.digest) throw Object.assign(new Error('The exact artifact must complete in staging against the preflighted target before production approval or execution.'), { code: 'STAGING_DEPLOYMENT_REQUIRED', statusCode: 409 });
  }
}

async function assertFlagStagingEvidence(change) {
  if (change.environment === 'development') return;
  const preflight = await ProviderPreflight.findOne({ provider: 'launchdarkly', environment: 'staging', flagKey: change.flagKey }).sort({ checkedAt: -1 }).lean();
  if (!preflight || preflight.status !== 'PASS') throw Object.assign(new Error('The latest LaunchDarkly staging preflight for this flag must pass before approval or execution.'), { code: 'LAUNCHDARKLY_STAGING_PREFLIGHT_REQUIRED', statusCode: 409 });
  const stagedIntegration = await InfrastructureIntegration.findOne({ _id: preflight.integrationId, revokedAt: null }).lean();
  if (!stagedIntegration || stagedIntegration.provider !== 'launchdarkly' || stagedIntegration.environment !== 'staging'
    || stagedIntegration.verification?.authenticated !== true || stagedIntegration.verification?.discoveryPassed !== true
    || targetConfigDigest(stagedIntegration.targetConfig) !== preflight.targetDigest) throw Object.assign(new Error('The preflighted LaunchDarkly staging target changed or is no longer verified.'), { code: 'LAUNCHDARKLY_PREFLIGHT_STALE', statusCode: 409 });
  if (change.environment === 'staging' && String(preflight.integrationId) !== String(change.integrationId)) throw Object.assign(new Error('The flag change must use the exact LaunchDarkly integration that passed preflight.'), { code: 'LAUNCHDARKLY_PREFLIGHT_INTEGRATION_MISMATCH', statusCode: 409 });
  if (change.environment === 'production') {
    const stagedChange = await FlagChange.findOne({
      flagKey: change.flagKey, environment: 'staging', integrationId: preflight.integrationId,
      strategy: change.strategy, rolloutPercent: change.rolloutPercent, status: { $in: ['SUCCEEDED','ROLLED_BACK'] }
    }).sort({ updatedAt: -1 }).lean();
    if (!stagedChange) throw Object.assign(new Error('The same flag, strategy and percentage must complete in staging against the preflighted target before production approval or execution.'), { code: 'LAUNCHDARKLY_STAGING_ROLLOUT_REQUIRED', statusCode: 409 });
  }
}

async function assertProductionReleaseReady() {
  const readiness = await getProductionReleaseReadiness();
  if (!readiness.ready) {
    const missing = (readiness.providers || []).filter(item => !item.ready).map(item => item.provider + ': ' + ['preflight','targetVerified','deployment','rollback'].filter(key => !item[key]).join('/')).join('; ');
    throw Object.assign(new Error('Production remains locked until all five providers pass staging preflight, target verification, deployment and rollback rehearsal. Outstanding: ' + (missing || 'provider evidence incomplete')), { code: 'PRODUCTION_STAGING_GATE_BLOCKED', statusCode: 423 });
  }
  return readiness;
}

async function loadDeployIntegration(integrationId, provider, environment, capability = 'deploy') {
  if (!validId(integrationId)) throw new Error('A valid verified provider integration is required.');
  const integration = await InfrastructureIntegration.findOne({ _id: integrationId, revokedAt: null });
  if (!integration) throw new Error('Provider integration is missing or revoked.');
  if (integration.provider !== provider || integration.environment !== environment) throw new Error('Provider and environment must match the saved integration.');
  if (integration.verification?.authenticated !== true || integration.verification?.discoveryPassed !== true) throw new Error('Provider integration must pass authentication and read-only discovery verification first.');
  if (environment === 'production' && integration.verification?.tlsVerified !== true) throw new Error('Production deployment requires verified TLS.');
  if (!integration.requestedCapabilities?.includes(capability)) throw new Error(`Provider integration did not request the ${capability} capability.`);
  if (!integration.grantedScopes?.some(scope => ['operate', 'manage'].includes(scope))) throw new Error('Provider integration has no verified operational scope.');
  return { integration, credentials: decryptCredentialPayload(integration.secretEnvelope) };
}

router.get('/catalog', (_req, res) => res.json({
  success: true,
  generators: ['docker', 'docker-compose', 'kubernetes', 'terraform', 'ansible', 'github-actions', 'runtime-config'],
  providers: ['aws', 'azure', 'gcp', 'kubernetes', 'generic'],
  runtimes: ['node', 'python', 'go', 'java'],
  environments: ['development', 'staging', 'production'],
  strategies: Object.entries(DEPLOYMENT_STRATEGIES).map(([id, stages]) => ({ id, stages })),
  safety: { arbitraryShell: false, remoteTerminal: false, secretsInArtifacts: false, productionApprovalRequired: true }
}));

router.post('/providers/preflight', async (req, res) => {
  try {
    const provider = String(req.body?.provider || '').toLowerCase();
    const environment = String(req.body?.environment || '').toLowerCase();
    if (!['aws', 'azure', 'gcp', 'kubernetes', 'launchdarkly'].includes(provider)) return res.status(400).json({ success: false, code: 'UNSUPPORTED_PROVIDER' });
    if (environment !== 'staging') return res.status(403).json({ success: false, code: 'STAGING_ONLY_PREFLIGHT' });
    const capability = provider === 'launchdarkly' ? 'manage' : 'deploy';
    if (provider === 'launchdarkly' && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(String(req.body?.flagKey || ''))) return res.status(400).json({ success: false, code: 'PREFLIGHT_FLAG_KEY_REQUIRED' });
    const { integration, credentials } = await loadDeployIntegration(req.body?.integrationId, provider, environment, capability);
    let artifact = null;
    if (provider !== 'launchdarkly') {
      if (!validId(req.body?.artifactId)) return res.status(400).json({ success: false, code: 'STAGING_ARTIFACT_REQUIRED', message: 'Select a validated staging artifact before running provider deployment preflight.' });
      artifact = await Artifact.findById(req.body.artifactId).lean();
      if (!artifact || artifact.validation?.status !== 'PASS' || artifact.provider !== provider || artifact.environment !== environment) return res.status(422).json({ success: false, code: 'STAGING_ARTIFACT_INVALID' });
    }
    const result = await adapterRequest('/v1/preflight', {
      provider, environment, capabilities: integration.grantedScopes,
      integration: { id: String(integration._id), provider, environment, endpoint: integration.endpoint, targetConfig: integration.targetConfig || {} },
      credentials,
      deployment: artifact ? { serviceName: artifact.serviceName, files: artifact.files, image: artifact.config?.image || null, artifactDigest: artifact.digest } : undefined,
      flag: provider === 'launchdarkly' ? { key: String(req.body?.flagKey || '') } : undefined
    });
    const preflightStatus = result.success && result.evidence?.status === 'PASS' ? 'PASS' : result.evidence?.status === 'FAIL' ? 'FAIL' : 'BLOCKED';
    await ProviderPreflight.create({
      provider, environment, integrationId: integration._id, artifactId: artifact?._id || null,
      artifactDigest: artifact?.digest || null, targetDigest: targetConfigDigest(integration.targetConfig), serviceName: artifact?.serviceName || null,
      flagKey: provider === 'launchdarkly' ? String(req.body?.flagKey || '') : null,
      status: preflightStatus, evidenceRunId: result.evidence?.runId || null, checkedBy: actorOf(req)
    });
    await audit(req, 'PROVIDER_STAGING_PREFLIGHT', preflightStatus, 'integration', integration._id, { provider, environment, evidenceRunId: result.evidence?.runId || null, evidenceStatus: result.evidence?.status || 'UNKNOWN', artifactDigest: artifact?.digest || null, flagKey: provider === 'launchdarkly' ? String(req.body?.flagKey || '') : null });
    return res.status(result.success ? 200 : 424).json(result);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || 'PROVIDER_PREFLIGHT_FAILED', message: error.message });
  }
});

router.post('/artifacts/generate', async (req, res) => {
  try {
    const generated = generateDeploymentFiles(req.body || {});
    const validation = validateGeneratedArtifact(generated.files);
    if (!validation.valid) return res.status(422).json({ success: false, code: 'GENERATED_ARTIFACT_POLICY_FAILED', errors: validation.errors });
    const artifact = await Artifact.create({
      serviceName: generated.config.serviceName,
      environment: generated.config.environment,
      provider: generated.config.provider,
      config: generated.config,
      files: Object.entries(generated.files).map(([path, content]) => ({ path, content })),
      digest: generated.digest,
      validation: { status: 'PASS', errors: [], checkedAt: new Date() },
      createdBy: actorOf(req)
    });
    await audit(req, 'ARTIFACT_GENERATED', 'SUCCESS', 'artifact', artifact._id, { serviceName: artifact.serviceName, environment: artifact.environment, provider: artifact.provider, digest: artifact.digest, fileCount: artifact.files.length });
    return res.status(201).json({ success: true, artifact: { id: artifact._id, serviceName: artifact.serviceName, environment: artifact.environment, provider: artifact.provider, digest: artifact.digest, fileCount: artifact.files.length, validation: artifact.validation, createdAt: artifact.createdAt }, files: artifact.files });
  } catch (error) {
    return res.status(400).json({ success: false, code: error.code || 'ARTIFACT_GENERATION_FAILED', message: error.message, details: error.details || [] });
  }
});

router.get('/artifacts', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const items = await Artifact.find({}).sort({ createdAt: -1 }).limit(limit).select('-files').lean();
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, artifacts: items });
});

router.get('/artifacts/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid artifact ID.' });
  const artifact = await Artifact.findById(req.params.id).lean();
  if (!artifact) return res.status(404).json({ success: false, message: 'Artifact not found.' });
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, artifact });
});

router.post('/artifacts/:id/validate', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid artifact ID.' });
  const artifact = await Artifact.findById(req.params.id);
  if (!artifact) return res.status(404).json({ success: false, message: 'Artifact not found.' });
  const result = validateGeneratedArtifact(Object.fromEntries(artifact.files.map(file => [file.path, file.content])));
  artifact.validation = { status: result.valid ? 'PASS' : 'FAIL', errors: result.errors, checkedAt: new Date() };
  await artifact.save();
  await audit(req, 'ARTIFACT_VALIDATED', result.valid ? 'PASS' : 'FAIL', 'artifact', artifact._id, { errors: result.errors });
  return res.json({ success: result.valid, validation: artifact.validation });
});

router.post('/configurations', async (req, res) => {
  try {
    const serviceName = String(req.body?.serviceName || '').trim().toLowerCase();
    const environment = String(req.body?.environment || '').toLowerCase();
    const values = req.body?.values || {};
    const secretRefs = req.body?.secretRefs || {};
    const changeReference = String(req.body?.changeReference || '').trim().slice(0, 120);
    if (!safeName.test(serviceName) || !['development', 'staging', 'production'].includes(environment)) throw new Error('A valid service name and environment are required.');
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 40) throw new Error('Configuration values must be an object with at most 40 entries.');
    if (!secretRefs || typeof secretRefs !== 'object' || Array.isArray(secretRefs) || Object.keys(secretRefs).length > 40) throw new Error('Secret references must be an object with at most 40 entries.');
    for (const [key, value] of Object.entries(values)) {
      if (!allowedConfigKeys.has(key)) throw new Error(`Configuration key ${key} is not allow-listed.`);
      if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Configuration value ${key} must be a string, number or boolean.`);
      if (typeof value === 'string' && value.length > 500) throw new Error(`Configuration value ${key} is too long.`);
      if (/secret|token|password|credential|private.?key|database_url/i.test(key)) throw new Error('Secret values are not accepted. Store secrets in the managed secret provider and submit only references.');
      if (key === 'NODE_ENV' && value !== environment) throw new Error('NODE_ENV must match the selected configuration environment.');
      if (key === 'PORT' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535)) throw new Error('PORT must be an integer from 1 to 65535.');
      if (key === 'LOG_LEVEL' && !['fatal', 'error', 'warn', 'info', 'debug'].includes(String(value))) throw new Error('LOG_LEVEL must be fatal, error, warn, info or debug.');
      if (key === 'FEATURE_FLAG_ENVIRONMENT' && !['development', 'staging', 'production'].includes(String(value))) throw new Error('FEATURE_FLAG_ENVIRONMENT is invalid.');
      if (key === 'HEALTH_PATH' && (typeof value !== 'string' || !/^\/[a-zA-Z0-9/_-]{0,100}$/.test(value))) throw new Error('HEALTH_PATH must be a local absolute path.');
      if (key === 'PUBLIC_BASE_URL') { const url = new URL(String(value)); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('PUBLIC_BASE_URL must be an HTTPS URL without credentials.'); }
    }
    for (const [key, ref] of Object.entries(secretRefs)) {
      if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(key) || typeof ref !== 'string' || !safeSecretRef.test(ref) || ref.split('/').includes('..') || ref.includes('\\')) throw new Error('Secret references must use an environment variable name and a managed secret reference ID.');
    }
    if (environment === 'production' && !changeReference) throw new Error('Production configuration requires a change reference.');
    const previous = await Configuration.findOne({ serviceName, environment }).sort({ version: -1 }).select('version').lean();
    const config = await Configuration.create({
      serviceName, environment, version: (previous?.version || 0) + 1,
      values, secretRefs, changeReference: changeReference || null, createdBy: actorOf(req)
    });
    await audit(req, 'CONFIGURATION_VERSION_CREATED', 'SUCCESS', 'configuration', config._id, { serviceName, environment, version: config.version, secretRefKeys: Object.keys(secretRefs) });
    return res.status(201).json({ success: true, configuration: config.toObject() });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.get('/configurations', async (req, res) => {
  const query = {};
  if (req.query.serviceName) query.serviceName = String(req.query.serviceName).slice(0, 52);
  if (req.query.environment) query.environment = String(req.query.environment);
  const items = await Configuration.find(query).sort({ createdAt: -1 }).limit(100).lean();
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, configurations: items });
});

router.post('/deployments/plan', async (req, res) => {
  try {
    const { artifactId, provider, environment, strategy, integrationId, changeReference } = req.body || {};
    if (!validId(artifactId)) throw new Error('A valid generated artifact is required.');
    const artifact = await Artifact.findById(artifactId);
    if (!artifact || artifact.validation?.status !== 'PASS') throw new Error('Deployment requires a generated artifact that passed validation.');
    if (artifact.provider !== provider || artifact.environment !== environment) throw new Error('Deployment provider and environment must match the generated artifact.');
    if (!Object.hasOwn(DEPLOYMENT_STRATEGIES, strategy)) throw new Error('Unsupported deployment strategy.');
    const { integration } = await loadDeployIntegration(integrationId, provider, environment, 'deploy');
    if (environment === 'production') await assertProductionReleaseReady();
    if (environment !== 'development' && ['aws','azure','gcp','kubernetes'].includes(provider)) {
      const stagedPreflight = await ProviderPreflight.findOne({ provider, environment: 'staging', artifactDigest: artifact.digest, serviceName: artifact.serviceName }).sort({ checkedAt: -1 }).lean();
      if (!stagedPreflight || stagedPreflight.status !== 'PASS') throw Object.assign(new Error('A passing latest staging provider preflight for this exact artifact is required before creating a deployment plan.'), { code: 'STAGING_PREFLIGHT_REQUIRED', statusCode: 409 });
      const stagedIntegration = await InfrastructureIntegration.findOne({ _id: stagedPreflight.integrationId, revokedAt: null }).lean();
      if (!stagedIntegration || stagedIntegration.verification?.authenticated !== true || stagedIntegration.verification?.discoveryPassed !== true || targetConfigDigest(stagedIntegration.targetConfig) !== stagedPreflight.targetDigest) throw Object.assign(new Error('Staging provider target changed or its verification expired; run staging preflight again.'), { code: 'STAGING_PREFLIGHT_STALE', statusCode: 409 });
      if (environment === 'staging' && String(stagedPreflight.integrationId) !== String(integration._id)) throw Object.assign(new Error('Run staging preflight again using the selected staging integration.'), { code: 'STAGING_PREFLIGHT_INTEGRATION_MISMATCH', statusCode: 409 });
      if (environment === 'production') {
        const stagedDeployment = await Deployment.findOne({ provider, environment: 'staging', serviceName: artifact.serviceName, integrationId: stagedPreflight.integrationId, status: { $in: ['SUCCEEDED','ROLLED_BACK'] } }).sort({ updatedAt: -1 }).lean();
        const stagedArtifact = stagedDeployment ? await Artifact.findById(stagedDeployment.artifactId).lean() : null;
        if (!stagedArtifact || stagedArtifact.digest !== artifact.digest) throw Object.assign(new Error('The exact artifact must complete successfully in staging against the preflighted target before production planning is enabled.'), { code: 'STAGING_DEPLOYMENT_REQUIRED', statusCode: 409 });
      }
    }
    const reference = String(changeReference || '').trim().slice(0, 120);
    if (!reference) throw new Error('A change/ticket reference is required for every deployment.');
    const deployment = await Deployment.create({
      artifactId: artifact._id, serviceName: artifact.serviceName, provider, environment, strategy,
      integrationId: integration._id, requestedBy: actorOf(req), changeReference: reference,
      rolloutStages: DEPLOYMENT_STRATEGIES[strategy].map(percent => ({ trafficPercent: percent, automaticPromotion: false }))
    });
    await audit(req, 'DEPLOYMENT_PLAN_CREATED', 'PENDING_APPROVAL', 'deployment', deployment._id, { serviceName: deployment.serviceName, provider, environment, strategy, artifactDigest: artifact.digest, changeReference: reference });
    return res.status(201).json({ success: true, deployment });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || 'DEPLOYMENT_PLAN_REJECTED', message: error.message });
  }
});

router.get('/deployments', async (_req, res) => {
  const items = await Deployment.find({}).sort({ createdAt: -1 }).limit(100).lean();
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, deployments: items });
});

router.post('/deployments/:id/approve', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid deployment ID.' });
  const deployment = await Deployment.findById(req.params.id);
  if (!deployment) return res.status(404).json({ success: false, message: 'Deployment not found.' });
  if (deployment.status !== 'PENDING_APPROVAL') return res.status(409).json({ success: false, message: `Deployment is ${deployment.status}; only pending plans can be approved.` });
  if (['aws','azure','gcp','kubernetes'].includes(deployment.provider)) {
    const artifact = await Artifact.findById(deployment.artifactId).lean();
    try { if (!artifact || artifact.validation?.status !== 'PASS') throw Object.assign(new Error('Validated artifact is unavailable.'), { statusCode: 409, code: 'ARTIFACT_INVALID' }); await assertDeploymentStagingEvidence(deployment, artifact); }
    catch (error) { return res.status(error.statusCode || 409).json({ success: false, code: error.code || 'STAGING_EVIDENCE_REQUIRED', message: error.message }); }
  }
  if (deployment.environment === 'production') { try { await assertProductionReleaseReady(); } catch (error) { return res.status(error.statusCode || 423).json({ success: false, code: error.code || 'PRODUCTION_STAGING_GATE_BLOCKED', message: error.message }); } }
  if (req.body?.confirmation !== 'APPROVE DEPLOYMENT') return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Type APPROVE DEPLOYMENT to continue.' });
  if (deployment.environment === 'production' && deployment.requestedBy === actorOf(req)) return res.status(403).json({ success: false, code: 'SEPARATION_OF_DUTIES_REQUIRED', message: 'A different Super Admin must approve production deployments.' });
  deployment.status = 'APPROVED';
  deployment.approvedBy = actorOf(req);
  deployment.approvedAt = new Date();
  await deployment.save();
  await audit(req, 'DEPLOYMENT_APPROVED', 'SUCCESS', 'deployment', deployment._id, { environment: deployment.environment, requestedBy: deployment.requestedBy, changeReference: deployment.changeReference });
  return res.json({ success: true, deployment });
});

router.post('/deployments/:id/execute', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid deployment ID.' });
  const deployment = await Deployment.findById(req.params.id);
  if (!deployment) return res.status(404).json({ success: false, message: 'Deployment not found.' });
  if (deployment.status !== 'APPROVED') return res.status(409).json({ success: false, message: 'Deployment must be approved before execution.' });
  if (['aws','azure','gcp','kubernetes'].includes(deployment.provider)) {
    const artifact = await Artifact.findById(deployment.artifactId).lean();
    try { if (!artifact || artifact.validation?.status !== 'PASS') throw Object.assign(new Error('Validated artifact is unavailable.'), { statusCode: 409, code: 'ARTIFACT_INVALID' }); await assertDeploymentStagingEvidence(deployment, artifact); }
    catch (error) { return res.status(error.statusCode || 409).json({ success: false, code: error.code || 'STAGING_EVIDENCE_REQUIRED', message: error.message }); }
  }
  if (deployment.environment === 'production') { try { await assertProductionReleaseReady(); } catch (error) { return res.status(error.statusCode || 423).json({ success: false, code: error.code || 'PRODUCTION_STAGING_GATE_BLOCKED', message: error.message }); } }
  if (req.body?.confirmation !== 'EXECUTE DEPLOYMENT') return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Type EXECUTE DEPLOYMENT to continue.' });
  try {
    const { integration, credentials } = await loadDeployIntegration(deployment.integrationId, deployment.provider, deployment.environment, 'deploy');
    const artifact = await Artifact.findById(deployment.artifactId).lean();
    if (!artifact || artifact.validation?.status !== 'PASS') throw new Error('The validated deployment artifact is no longer available.');
    const result = await adapterRequest('/v1/deployments/execute', {
      integration: { id: String(integration._id), provider: integration.provider, environment: integration.environment, endpoint: integration.endpoint, targetConfig: integration.targetConfig || {} },
      credentials,
      deployment: {
        id: String(deployment._id), serviceName: deployment.serviceName, provider: deployment.provider,
        environment: deployment.environment, strategy: deployment.strategy, changeReference: deployment.changeReference,
        artifactDigest: artifact.digest, image: artifact.config?.image || null, files: artifact.files
      }
    });
    if (!result.accepted || !result.deploymentId) throw new Error('Provider adapter did not return a confirmed deployment acceptance.');
    deployment.status = result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'SUBMITTED';
    deployment.remoteDeploymentId = String(result.deploymentId).slice(0, 180);
    deployment.remoteStatus = String(result.status || 'ACCEPTED').slice(0, 80);
    deployment.rollbackAvailable = result.rollbackAvailable === true || result.job?.rollbackAvailable === true;
    await deployment.save();
    await audit(req, 'DEPLOYMENT_SUBMITTED', 'ACCEPTED', 'deployment', deployment._id, { provider: deployment.provider, remoteDeploymentId: deployment.remoteDeploymentId, changeReference: deployment.changeReference });
    return res.json({ success: true, accepted: true, deployment, message: deployment.status === 'SUCCEEDED' ? 'Provider deployment completed and the driver confirmed success.' : 'Provider accepted the deployment request. Poll provider status to verify completion; acceptance is not success.' });
  } catch (error) {
    deployment.lastErrorCode = error.code || 'DEPLOYMENT_SUBMISSION_FAILED';
    await deployment.save();
    await audit(req, 'DEPLOYMENT_SUBMISSION_FAILED', 'FAILED', 'deployment', deployment._id, { errorCode: deployment.lastErrorCode });
    return res.status(error.statusCode || 502).json({ success: false, code: deployment.lastErrorCode, message: error.message });
  }
});

router.get('/deployments/:id/status', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid deployment ID.' });
  const deployment = await Deployment.findById(req.params.id);
  if (!deployment || !deployment.remoteDeploymentId) return res.status(404).json({ success: false, message: 'Submitted deployment not found.' });
  try {
    const { integration, credentials } = await loadDeployIntegration(deployment.integrationId, deployment.provider, deployment.environment, 'deploy');
    const result = await adapterRequest('/v1/deployments/status', {
      integration: { id: String(integration._id), provider: integration.provider, environment: integration.environment, endpoint: integration.endpoint, targetConfig: integration.targetConfig || {} },
      credentials,
      deployment: { id: String(deployment._id), remoteDeploymentId: deployment.status === 'ROLLBACK_REQUESTED' && deployment.rollbackRequestId ? deployment.rollbackRequestId : deployment.remoteDeploymentId }
    });
    const allowed = new Set(['SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ROLLBACK_REQUESTED', 'ROLLED_BACK']);
    const state = String(result.status || '').toUpperCase();
    if (!allowed.has(state)) return res.status(502).json({ success: false, message: 'Provider returned an unsupported deployment state.' });
    deployment.status = state;
    deployment.remoteStatus = state;
    if (state === 'ROLLED_BACK') deployment.rollbackRequestId = null;
    deployment.lastErrorCode = state === 'FAILED' ? String(result.errorCode || 'REMOTE_DEPLOYMENT_FAILED').slice(0, 100) : null;
    await deployment.save();
    await audit(req, 'DEPLOYMENT_STATUS_REFRESHED', state, 'deployment', deployment._id, { provider: deployment.provider, remoteDeploymentId: deployment.remoteDeploymentId });
    return res.json({ success: true, deployment });
  } catch (error) {
    return res.status(error.statusCode || 502).json({ success: false, code: error.code || 'DEPLOYMENT_STATUS_FAILED', message: error.message });
  }
});

router.post('/deployments/:id/rollback', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid deployment ID.' });
  const deployment = await Deployment.findById(req.params.id);
  if (!deployment || !deployment.remoteDeploymentId) return res.status(404).json({ success: false, message: 'Submitted deployment not found.' });
  if (deployment.rollbackAvailable !== true) return res.status(409).json({ success: false, code: 'ROLLBACK_SNAPSHOT_UNAVAILABLE', message: 'No previous successful artifact is available for a safe automatic rollback.' });
  if (!['SUBMITTED', 'RUNNING', 'SUCCEEDED', 'FAILED'].includes(deployment.status)) return res.status(409).json({ success: false, message: 'Deployment is not in a rollback-eligible state.' });
  if (req.body?.confirmation !== 'ROLLBACK DEPLOYMENT') return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Type ROLLBACK DEPLOYMENT to continue.' });
  try {
    const { integration, credentials } = await loadDeployIntegration(deployment.integrationId, deployment.provider, deployment.environment, 'deploy');
    const result = await adapterRequest('/v1/deployments/rollback', {
      integration: { id: String(integration._id), provider: integration.provider, environment: integration.environment, endpoint: integration.endpoint, targetConfig: integration.targetConfig || {} },
      credentials,
      deployment: { id: String(deployment._id), remoteDeploymentId: deployment.remoteDeploymentId, serviceName: deployment.serviceName, changeReference: deployment.changeReference }
    });
    if (!result.accepted) throw new Error('Provider adapter did not confirm rollback acceptance.');
    deployment.rollbackRequestId = result.job?.jobId || result.requestId || result.deploymentId || null;
    deployment.status = result.status === 'ROLLED_BACK' ? 'ROLLED_BACK' : 'ROLLBACK_REQUESTED';
    deployment.remoteStatus = String(result.status || 'ROLLBACK_ACCEPTED').slice(0, 80);
    await deployment.save();
    await audit(req, 'DEPLOYMENT_ROLLBACK_REQUESTED', 'ACCEPTED', 'deployment', deployment._id, { provider: deployment.provider, remoteDeploymentId: deployment.remoteDeploymentId });
    return res.json({ success: true, accepted: true, deployment, message: 'Rollback accepted by provider; refresh status to verify completion.' });
  } catch (error) {
    await audit(req, 'DEPLOYMENT_ROLLBACK_FAILED', 'FAILED', 'deployment', deployment._id, { errorCode: error.code || 'ROLLBACK_FAILED' });
    return res.status(error.statusCode || 502).json({ success: false, code: error.code || 'ROLLBACK_FAILED', message: error.message });
  }
});

router.get('/feature-flags/changes', async (_req, res) => {
  const changes = await FlagChange.find({}).sort({ createdAt: -1 }).limit(100).lean();
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, changes });
});

router.post('/feature-flags/rollout', async (req, res) => {
  try {
    const { integrationId, environment, flagKey, strategy = 'progressive', rolloutPercent = 100, changeReference } = req.body || {};
    const key = String(flagKey || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(key)) throw new Error('Feature flag key is invalid.');
    if (!['development', 'staging', 'production'].includes(environment)) throw new Error('Feature flag environment is invalid.');
    if (!['canary', 'progressive', 'ring', 'blue_green', 'kill_switch'].includes(strategy)) throw new Error('Unsupported feature flag rollout strategy.');
    const percent = Number(rolloutPercent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Rollout percentage must be between 0 and 100.');
    const reference = String(changeReference || '').trim().slice(0, 120);
    if (!reference) throw new Error('A change/ticket reference is required for feature flag changes.');
    const { integration } = await loadDeployIntegration(integrationId, 'launchdarkly', environment, 'manage');
    if (environment === 'production') await assertProductionReleaseReady();
    if (environment !== 'development') {
    const stagedPreflight = await ProviderPreflight.findOne({ provider: 'launchdarkly', environment: 'staging', flagKey: key }).sort({ checkedAt: -1 }).lean();
    if (!stagedPreflight || stagedPreflight.status !== 'PASS') throw Object.assign(new Error('A passing latest LaunchDarkly staging preflight for this flag is required before rollout planning.'), { code: 'LAUNCHDARKLY_STAGING_PREFLIGHT_REQUIRED', statusCode: 409 });
    const stagedIntegration = await InfrastructureIntegration.findOne({ _id: stagedPreflight.integrationId, revokedAt: null }).lean();
    if (!stagedIntegration || stagedIntegration.verification?.authenticated !== true || stagedIntegration.verification?.discoveryPassed !== true || targetConfigDigest(stagedIntegration.targetConfig) !== stagedPreflight.targetDigest) throw Object.assign(new Error('LaunchDarkly staging target changed or its verification expired; run preflight again.'), { code: 'LAUNCHDARKLY_PREFLIGHT_STALE', statusCode: 409 });
    if (environment === 'staging' && String(stagedPreflight.integrationId) !== String(integration._id)) throw Object.assign(new Error('Run LaunchDarkly staging preflight again using the selected integration.'), { code: 'LAUNCHDARKLY_PREFLIGHT_INTEGRATION_MISMATCH', statusCode: 409 });
    if (environment === 'production') {
      const stagedChange = await FlagChange.findOne({ flagKey: key, environment: 'staging', integrationId: stagedPreflight.integrationId, strategy, rolloutPercent: strategy === 'kill_switch' ? 0 : percent, status: { $in: ['SUCCEEDED','ROLLED_BACK'] } }).sort({ updatedAt: -1 }).lean();
      if (!stagedChange) throw Object.assign(new Error('The same LaunchDarkly flag strategy and percentage must complete in staging before production rollout planning.'), { code: 'LAUNCHDARKLY_STAGING_ROLLOUT_REQUIRED', statusCode: 409 });
    }
    }
    const change = await FlagChange.create({
      flagKey: key, environment, strategy,
      rolloutPercent: strategy === 'kill_switch' ? 0 : percent,
      integrationId: integration._id, requestedBy: actorOf(req), changeReference: reference,
      status: 'PENDING_APPROVAL'
    });
    await audit(req, 'LAUNCHDARKLY_FLAG_CHANGE_PLANNED', 'PENDING_APPROVAL', 'feature_flag', change._id, { flagKey: key, environment, strategy, rolloutPercent: change.rolloutPercent, changeReference: reference });
    return res.status(201).json({ success: true, change, message: 'Feature-flag rollout plan created. It must be approved before the LaunchDarkly adapter is called.' });
  } catch (error) {
    await audit(req, 'LAUNCHDARKLY_FLAG_ROLLOUT_PLAN_FAILED', 'FAILED', 'feature_flag', String(req.body?.flagKey || 'unknown'), { errorCode: error.code || 'FLAG_ROLLOUT_FAILED' });
    return res.status(error.statusCode || 400).json({ success: false, code: error.code || 'FLAG_ROLLOUT_FAILED', message: error.message });
  }
});

router.post('/feature-flags/changes/:id/approve', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid feature-flag change ID.' });
  const change = await FlagChange.findById(req.params.id);
  if (!change) return res.status(404).json({ success: false, message: 'Feature-flag change not found.' });
  if (change.status !== 'PENDING_APPROVAL') return res.status(409).json({ success: false, message: 'Only pending feature-flag changes can be approved.' });
  try { await assertFlagStagingEvidence(change); } catch (error) { return res.status(error.statusCode || 409).json({ success: false, code: error.code || 'LAUNCHDARKLY_STAGING_EVIDENCE_REQUIRED', message: error.message }); }
  if (change.environment === 'production') { try { await assertProductionReleaseReady(); } catch (error) { return res.status(error.statusCode || 423).json({ success: false, code: error.code || 'PRODUCTION_STAGING_GATE_BLOCKED', message: error.message }); } }
  if (req.body?.confirmation !== 'APPROVE FEATURE FLAG CHANGE') return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Type APPROVE FEATURE FLAG CHANGE to continue.' });
  if (change.environment === 'production' && change.requestedBy === actorOf(req)) return res.status(403).json({ success: false, code: 'SEPARATION_OF_DUTIES_REQUIRED', message: 'A different Super Admin must approve production feature-flag changes.' });
  change.status = 'APPROVED';
  change.approvedBy = actorOf(req);
  change.approvedAt = new Date();
  await change.save();
  await audit(req, 'LAUNCHDARKLY_FLAG_CHANGE_APPROVED', 'SUCCESS', 'feature_flag', change._id, { flagKey: change.flagKey, environment: change.environment, requestedBy: change.requestedBy });
  return res.json({ success: true, change });
});

router.post('/feature-flags/changes/:id/execute', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid feature-flag change ID.' });
  const change = await FlagChange.findById(req.params.id);
  if (!change) return res.status(404).json({ success: false, message: 'Feature-flag change not found.' });
  if (change.status !== 'APPROVED') return res.status(409).json({ success: false, message: 'Feature-flag change must be approved before execution.' });
  try { await assertFlagStagingEvidence(change); } catch (error) { return res.status(error.statusCode || 409).json({ success: false, code: error.code || 'LAUNCHDARKLY_STAGING_EVIDENCE_REQUIRED', message: error.message }); }
  if (change.environment === 'production') { try { await assertProductionReleaseReady(); } catch (error) { return res.status(error.statusCode || 423).json({ success: false, code: error.code || 'PRODUCTION_STAGING_GATE_BLOCKED', message: error.message }); } }
  if (req.body?.confirmation !== 'EXECUTE FEATURE FLAG CHANGE') return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Type EXECUTE FEATURE FLAG CHANGE to continue.' });
  try {
    const { integration, credentials } = await loadDeployIntegration(change.integrationId, 'launchdarkly', change.environment, 'manage');
    const result = await adapterRequest('/v1/feature-flags/rollout', {
      integration: { id: String(integration._id), provider: 'launchdarkly', environment: change.environment, endpoint: integration.endpoint, targetConfig: integration.targetConfig || {} },
      credentials,
      flag: { key: change.flagKey, strategy: change.strategy, rolloutPercent: change.rolloutPercent, stages: DEPLOYMENT_STRATEGIES[change.strategy], changeReference: change.changeReference }
    });
    if (!result.accepted) throw new Error('LaunchDarkly adapter did not confirm the flag rollout request.');
    change.status = result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'SUBMITTED';
    change.remoteRequestId = String(result.requestId || '').slice(0, 180) || null;
    change.remoteStatus = String(result.status || 'ACCEPTED').slice(0, 80);
    await change.save();
    await audit(req, 'LAUNCHDARKLY_FLAG_ROLLOUT_SUBMITTED', 'ACCEPTED', 'feature_flag', change._id, { flagKey: change.flagKey, environment: change.environment, strategy: change.strategy, remoteRequestId: change.remoteRequestId });
    return res.json({ success: true, accepted: true, change, message: 'LaunchDarkly adapter accepted the rollout request. Confirm the flag state in provider status.' });
  } catch (error) {
    change.status = 'FAILED';
    change.remoteStatus = 'FAILED';
    await change.save();
    await audit(req, 'LAUNCHDARKLY_FLAG_ROLLOUT_FAILED', 'FAILED', 'feature_flag', change._id, { errorCode: error.code || 'FLAG_ROLLOUT_FAILED' });
    return res.status(error.statusCode || 502).json({ success: false, code: error.code || 'FLAG_ROLLOUT_FAILED', message: error.message });
  }
});


router.post('/feature-flags/changes/:id/rollback', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid feature-flag change ID.' });
  const change = await FlagChange.findById(req.params.id);
  if (!change) return res.status(404).json({ success: false, message: 'Feature-flag change not found.' });
  if (!['SUBMITTED','SUCCEEDED'].includes(change.status) || !change.remoteRequestId) return res.status(409).json({ success: false, code: 'FLAG_ROLLBACK_NOT_AVAILABLE', message: 'Only a submitted rollout with a recorded prior-state snapshot can be rolled back.' });
  if (req.body?.confirmation !== 'ROLLBACK FEATURE FLAG CHANGE') return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Type ROLLBACK FEATURE FLAG CHANGE to continue.' });
  try {
    const { integration, credentials } = await loadDeployIntegration(change.integrationId, 'launchdarkly', change.environment, 'manage');
    const result = await adapterRequest('/v1/feature-flags/rollback', {
      integration: { id: String(integration._id), provider: 'launchdarkly', environment: change.environment, endpoint: integration.endpoint, targetConfig: integration.targetConfig || {} },
      credentials, sourceRequestId: change.remoteRequestId, flag: { key: change.flagKey }
    });
    if (!result.success || result.status !== 'ROLLED_BACK') throw new Error('LaunchDarkly did not confirm prior-state restoration.');
    change.status = 'ROLLED_BACK';
    change.remoteStatus = 'ROLLED_BACK';
    await change.save();
    await audit(req, 'LAUNCHDARKLY_FLAG_ROLLED_BACK', 'SUCCESS', 'feature_flag', change._id, { flagKey: change.flagKey, environment: change.environment, sourceRequestId: change.remoteRequestId });
    return res.json({ success: true, change, message: 'The captured LaunchDarkly flag state was restored.' });
  } catch (error) {
    await audit(req, 'LAUNCHDARKLY_FLAG_ROLLBACK_FAILED', 'FAILED', 'feature_flag', change._id, { errorCode: error.code || 'FLAG_ROLLBACK_FAILED' });
    return res.status(error.statusCode || 502).json({ success: false, code: error.code || 'FLAG_ROLLBACK_FAILED', message: error.message });
  }
});

router.get('/release-readiness', async (_req, res) => {
  try {
    const readiness = await getProductionReleaseReadiness();
    res.set('Cache-Control', 'private, no-store');
    return res.json(readiness);
  } catch (error) {
    return res.status(error.statusCode || 503).json({ success: false, ready: false, code: error.code || 'RELEASE_READINESS_UNAVAILABLE', message: error.message });
  }
});

router.get('/audit', async (_req, res) => {
  const entries = await DevOpsAudit.find({}).sort({ occurredAt: -1 }).limit(200).lean();
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, entries });
});

export default router;
