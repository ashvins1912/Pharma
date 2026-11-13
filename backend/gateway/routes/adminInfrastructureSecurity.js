import express from 'express';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import {
  InfrastructureIntegration, encryptCredentialPayload, decryptCredentialPayload,
  publicIntegration, writeInfrastructureAudit
} from '../../security/infrastructureCredentialVault.js';

const router = express.Router();
router.use(authenticateUser, requireSuperAdmin);

const actorOf = req => String(req.user?.sub || req.user?.id || 'unknown-super-admin');
const requestIdOf = req => req.context?.requestId || req.gatewayRequestId || req.get('x-request-id') || null;
const allowedAuth = new Set(['api_token', 'oauth2_client_credentials', 'oauth2_authorization_code', 'basic', 'service_account', 'custom']);
const allowedScopes = new Set(['read', 'monitor', 'operate', 'manage', 'credential_admin']);
const allowedCapabilities = new Set(['read', 'monitor', 'start', 'stop', 'restart', 'deploy', 'scale', 'backup', 'restore', 'manage']);
const controlPlaneBase = () => {
  const raw = String(process.env.INFRASTRUCTURE_CONTROL_PLANE_URL || '').trim();
  if (!raw) throw new Error('Remote adapter control plane is not configured.');
  const url = new URL(raw);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Remote adapter must use HTTPS in production.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Control-plane URL must not contain credentials, query parameters or fragments.');
  return url.toString().replace(/\/$/, '');
};
async function adapterRequest(path, body) {
  const token = String(process.env.INFRASTRUCTURE_CONTROL_PLANE_TOKEN || '').trim();
  if (process.env.NODE_ENV === 'production' && !token) throw new Error('Control-plane service token is required in production.');
  const response = await fetch(new URL(path, controlPlaneBase()), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  if (text.length > 256 * 1024) throw new Error('Adapter response exceeded the allowed size.');
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error('Adapter returned an invalid response.'); }
  if (!response.ok) {
    const error = new Error(`Adapter verification failed with HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}
function validateEndpoint(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['https:', ...(process.env.NODE_ENV === 'production' ? [] : ['http:'])].includes(url.protocol)) throw new Error('Service endpoint must use HTTPS.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Endpoint cannot contain credentials, query parameters or fragments.');
  return url.toString().replace(/\/$/, '');
}
function assessPolicy(integration, verification) {
  const evidence = [];
  const check = (id, pass, detail) => evidence.push({ controlId: id, status: pass ? 'PASS' : 'FAIL', detail, checkedAt: new Date() });
  check('AUTHENTICATION', verification.authenticated === true, 'Adapter authentication verification');
  const granted = new Set(Array.isArray(verification.grantedScopes) ? verification.grantedScopes : []);
  const scopesPresent = integration.requestedScopes.every(scope => granted.has(scope));
  check('AUTHORIZATION_SCOPES', scopesPresent, scopesPresent ? 'Requested scopes are granted' : 'One or more requested scopes are missing');
  check('READ_ONLY_DISCOVERY', verification.discoveryPassed === true, 'Read-only discovery verification');
  check('TLS_TRANSPORT', process.env.NODE_ENV !== 'production' || verification.tlsVerified === true, 'Production TLS verification');
  check('SECRET_STORAGE', true, 'Credential payload encrypted at rest using AES-256-GCM');
  const passed = evidence.every(item => item.status === 'PASS');
  const complianceState = passed ? 'PASS' : 'FAIL';
  return { evidence, complianceState, state: passed ? 'ACTIVE_READ_ONLY' : (verification.authenticated ? 'POLICY_BLOCKED' : 'AUTHENTICATION_FAILED') };
}

router.get('/integrations', async (_req, res) => {
  const items = await InfrastructureIntegration.find({ revokedAt: null }).sort({ updatedAt: -1 }).limit(100).lean();
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, integrations: items.map(publicIntegration) });
});

router.post('/integrations', async (req, res) => {
  try {
    const { name, provider, environment, authMethod, endpoint, credentials, requestedScopes = ['read', 'monitor'], requestedCapabilities = ['read', 'monitor'] } = req.body || {};
    const normalizedProvider = String(provider || '').toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalizedProvider) || normalizedProvider === 'render') return res.status(400).json({ success: false, message: 'Enter a valid non-reserved provider identifier.' });
    if (!String(name || '').trim() || !['development', 'staging', 'production'].includes(environment) || !allowedAuth.has(authMethod)) return res.status(400).json({ success: false, message: 'Service name, environment and supported authentication method are required.' });
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || Object.keys(credentials).length === 0 || JSON.stringify(credentials).length > 24000 || Object.values(credentials).some(value => value === '' || value === null || value === undefined)) return res.status(400).json({ success: false, message: 'Credential payload must contain non-empty values and be under 24 KB.' });
    if (!Array.isArray(requestedScopes) || !requestedScopes.length || requestedScopes.some(scope => !allowedScopes.has(scope))) return res.status(400).json({ success: false, message: 'Invalid requested permission scopes.' });
    if (!Array.isArray(requestedCapabilities) || requestedCapabilities.some(capability => !allowedCapabilities.has(capability))) return res.status(400).json({ success: false, message: 'Invalid requested capabilities.' });
    const actor = actorOf(req);
    const integration = await InfrastructureIntegration.create({
      name: String(name).trim().slice(0, 120), provider: normalizedProvider, environment, authMethod,
      endpoint: validateEndpoint(endpoint), secretEnvelope: encryptCredentialPayload(credentials),
      requestedScopes: [...new Set(requestedScopes)], requestedCapabilities: [...new Set(requestedCapabilities)],
      state: 'PENDING_VERIFICATION', complianceState: 'NOT_ASSESSED', createdBy: actor, updatedBy: actor
    });
    await writeInfrastructureAudit({ integrationId: integration._id, actor, event: 'CREDENTIAL_SAVED', outcome: 'SUCCESS', details: { provider: normalizedProvider, environment, authMethod }, requestId: requestIdOf(req) });
    res.set('Cache-Control', 'no-store');
    return res.status(201).json({ success: true, integration: publicIntegration(integration), message: 'Credentials encrypted and saved. Run verification before activation.' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'Could not save integration.' });
  }
});

router.post('/integrations/:id/verify', async (req, res) => {
  const integration = await InfrastructureIntegration.findOne({ _id: req.params.id, revokedAt: null });
  if (!integration) return res.status(404).json({ success: false, message: 'Integration not found or revoked.' });
  const actor = actorOf(req);
  try {
    const credentials = decryptCredentialPayload(integration.secretEnvelope);
    const result = await adapterRequest('/v1/connections/verify', {
      integration: { id: String(integration._id), name: integration.name, provider: integration.provider, environment: integration.environment, authMethod: integration.authMethod, endpoint: integration.endpoint },
      credentials, requestedScopes: integration.requestedScopes, requestedCapabilities: integration.requestedCapabilities
    });
    const assessment = assessPolicy(integration, result);
    integration.grantedScopes = Array.isArray(result.grantedScopes) ? result.grantedScopes.filter(scope => allowedScopes.has(scope)) : [];
    integration.verification = {
      authenticated: result.authenticated === true,
      discoveryPassed: result.discoveryPassed === true,
      tlsVerified: result.tlsVerified === true,
      verifiedAt: new Date(),
      adapterRequestId: typeof result.requestId === 'string' ? result.requestId.slice(0, 120) : null
    };
    integration.policyEvidence = assessment.evidence;
    integration.complianceState = assessment.complianceState;
    integration.state = assessment.state;
    integration.lastVerifiedAt = new Date();
    integration.updatedBy = actor;
    await integration.save();
    await writeInfrastructureAudit({ integrationId: integration._id, actor, event: 'CONNECTION_VERIFIED', outcome: assessment.state, details: { provider: integration.provider, complianceState: assessment.complianceState, grantedScopes: integration.grantedScopes, evidence: assessment.evidence.map(({ controlId, status }) => ({ controlId, status })) }, requestId: requestIdOf(req) });
    return res.json({ success: true, integration: publicIntegration(integration), verification: integration.verification, evidence: integration.policyEvidence, message: assessment.state === 'ACTIVE_READ_ONLY' ? 'Read-only connection verified. Operational permissions remain disabled pending separate approval.' : 'Verification did not pass all required security gates.' });
  } catch (error) {
    integration.state = 'DEGRADED';
    integration.complianceState = 'FAIL';
    integration.verification = { authenticated: false, discoveryPassed: false, verifiedAt: new Date(), errorCode: 'VERIFICATION_FAILED' };
    integration.updatedBy = actor;
    await integration.save();
    await writeInfrastructureAudit({ integrationId: integration._id, actor, event: 'CONNECTION_VERIFICATION_FAILED', outcome: 'FAIL', details: { provider: integration.provider, errorCode: error.code || 'ADAPTER_ERROR' }, requestId: requestIdOf(req) });
    return res.status(502).json({ success: false, message: 'Connection verification failed. Credentials and provider response were not exposed.' });
  }
});

router.post('/integrations/:id/revoke', async (req, res) => {
  const integration = await InfrastructureIntegration.findById(req.params.id);
  if (!integration) return res.status(404).json({ success: false, message: 'Integration not found.' });
  const actor = actorOf(req);
  integration.revokedAt = new Date();
  integration.state = 'REVOKED';
  integration.set('secretEnvelope', undefined);
  integration.updatedBy = actor;
  await integration.save();
  await writeInfrastructureAudit({ integrationId: integration._id, actor, event: 'CREDENTIAL_REVOKED', outcome: 'SUCCESS', details: { provider: integration.provider }, requestId: requestIdOf(req) });
  return res.json({ success: true, message: 'Stored credential revoked and removed from active use.' });
});

router.get('/integrations/:id/audit', async (req, res) => {
  const integration = await InfrastructureIntegration.findById(req.params.id).select('_id');
  if (!integration) return res.status(404).json({ success: false, message: 'Integration not found.' });
  const entries = await (await import('../../security/infrastructureCredentialVault.js')).InfrastructureSecurityAudit.find({ integrationId: String(integration._id) }).sort({ occurredAt: -1 }).limit(200).lean();
  res.set('Cache-Control', 'private, no-store');
  return res.json({ success: true, entries });
});

export default router;
