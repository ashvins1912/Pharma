import express from 'express';
import mongoose from 'mongoose';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';

const router = express.Router();
router.use(authenticateUser, requireSuperAdmin);

const RENDER_API = 'https://api.render.com/v1';
const renderConfigured = () => Boolean(process.env.RENDER_API_KEY);
const renderRequest = async (path, options = {}) => {
  const response = await fetch(`${RENDER_API}${path}`, {
    ...options,
    headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.RENDER_API_KEY}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Render API returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
};
const normaliseRenderService = item => {
  const service = item?.service || item;
  return {
    id: service.id, name: service.name, type: service.type, provider: 'render',
    region: service.region || null, plan: service.plan || null,
    status: service.suspended ? 'SUSPENDED' : (service.serviceDetails?.url ? 'ACTIVE' : (service.status || 'UNKNOWN')),
    suspended: Boolean(service.suspended),
    dashboardUrl: service.dashboardUrl || null,
    capabilities: { start: Boolean(service.suspended), stop: !service.suspended && ['web_service', 'private_service', 'background_worker'].includes(service.type), restart: ['web_service', 'private_service', 'background_worker'].includes(service.type) },
    usage: { cpu: null, memoryBytes: null, memoryLimitBytes: null, outboundBytes: null, diskBytes: null, source: 'Metrics API is not included in Render service-list responses; connect an OpenTelemetry/Prometheus metrics adapter to populate usage.' }
  };
};
async function listRenderServices() {
  if (!renderConfigured()) return [];
  const result = await renderRequest('/services?limit=100');
  const entries = Array.isArray(result) ? result : (result?.services || result?.items || []);
  return entries.map(normaliseRenderService).filter(item => item.id);
}
async function getMongoUsage() {
  const db = mongoose.connection?.db;
  if (!db) return { configured: false, status: 'DISCONNECTED', collections: [], message: 'MongoDB connection is not ready.' };
  const [stats, collections] = await Promise.all([
    db.stats(),
    db.listCollections({}, { nameOnly: true }).toArray()
  ]);
  const details = await Promise.all(collections.map(async collection => {
    try {
      const result = await db.command({ collStats: collection.name, scale: 1 });
      return { name: collection.name, documents: result.count || 0, storageBytes: result.storageSize || 0, dataBytes: result.size || 0, indexBytes: result.totalIndexSize || 0, totalBytes: result.totalSize || 0 };
    } catch (error) {
      return { name: collection.name, error: error.message };
    }
  }));
  return {
    configured: true, status: 'CONNECTED', database: db.databaseName,
    storageBytes: stats.storageSize || 0, dataBytes: stats.dataSize || 0,
    indexBytes: stats.indexSize || 0, collectionsCount: collections.length,
    objects: stats.objects || 0, collections: details
  };
}
router.get('/status', async (_req, res) => {
  const providers = [];
  if (renderConfigured()) {
    try { providers.push({ id: 'render', name: 'Render', status: 'CONNECTED', resources: await listRenderServices() }); }
    catch (error) { providers.push({ id: 'render', name: 'Render', status: 'ERROR', error: error.message, resources: [] }); }
  } else providers.push({ id: 'render', name: 'Render', status: 'NOT_CONFIGURED', message: 'Set RENDER_API_KEY in the backend secret environment.' });
  let mongo;
  try { mongo = await getMongoUsage(); }
  catch (error) { mongo = { configured: false, status: 'ERROR', message: error.message }; }
  res.set('Cache-Control', 'private, no-store');
  return res.json({
    success: true, checkedAt: new Date().toISOString(),
    providers, databases: [{ id: 'mongodb', provider: 'mongodb', name: 'MongoDB', ...mongo }],
    metrics: {
      provider: process.env.INFRASTRUCTURE_METRICS_PROVIDER || null,
      endpointConfigured: Boolean(process.env.INFRASTRUCTURE_METRICS_ENDPOINT),
      note: 'Memory, CPU and network/bandwidth values are shown only when a metrics adapter supplies normalized samples. Never infer zero usage from missing telemetry.'
    },
    supportedAdapters: ['render', 'aws', 'azure', 'gcp', 'mongodb', 'atlas']
  });
});
router.post('/resources/:resourceId/:action', async (req, res) => {
  const { resourceId, action } = req.params;
  if (!['start', 'stop', 'restart'].includes(action)) return res.status(400).json({ success: false, message: 'Unsupported lifecycle action.' });
  if (!renderConfigured()) return res.status(503).json({ success: false, message: 'Render provider is not configured.' });
  if (req.body?.confirmation !== `${action.toUpperCase()} RESOURCE`) {
    return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: `Type ${action.toUpperCase()} RESOURCE to confirm.` });
  }
  try {
    const resources = await listRenderServices();
    const resource = resources.find(item => item.id === resourceId);
    if (!resource) return res.status(404).json({ success: false, message: 'Resource was not found in the configured Render workspace.' });
    if (!resource.capabilities[action]) return res.status(409).json({ success: false, message: `The ${action} action is not supported for this resource or current state.` });
    const endpoint = action === 'start' ? 'resume' : action === 'stop' ? 'suspend' : 'restart';
    await renderRequest(`/services/${encodeURIComponent(resourceId)}/${endpoint}`, { method: 'POST' });
    const actor = req.user?.sub || req.user?.id || 'super-admin';
    console.info(JSON.stringify({ event: 'infrastructure_resource_lifecycle', provider: 'render', resourceId, action, actor, at: new Date().toISOString() }));
    return res.json({ success: true, provider: 'render', resourceId, action, acceptedAt: new Date().toISOString(), actor, message: 'Provider accepted the lifecycle request. Refresh status to verify the resulting state.' });
  } catch (error) {
    return res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
export default router;
