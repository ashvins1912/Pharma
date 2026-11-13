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
  const isSuspended = service.suspended === true || service.suspended === 'suspended' || Boolean(service.suspendedAt);
  return {
    id: service.id, name: service.name, type: service.type, provider: 'render',
    region: service.region || null, plan: service.plan || null,
    status: isSuspended ? 'SUSPENDED' : (service.serviceDetails?.url ? 'ACTIVE' : (service.status || 'UNKNOWN')),
    suspended: isSuspended,
    dashboardUrl: service.dashboardUrl || null,
    capabilities: { start: isSuspended, stop: !isSuspended && ['web_service', 'private_service', 'background_worker'].includes(service.type), restart: ['web_service', 'private_service', 'background_worker'].includes(service.type) },
    usage: { cpu: null, memoryBytes: null, memoryLimitBytes: null, outboundBytes: null, diskBytes: null, source: 'Metrics API is not included in Render service-list responses; connect an OpenTelemetry/Prometheus metrics adapter to populate usage.' }
  };
};
const unitBytes = (value, unit) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const u = String(unit || '').trim().toLowerCase();
  const factors = { b: 1, byte: 1, bytes: 1, kb: 1000, kib: 1024, mb: 1000 ** 2, mib: 1024 ** 2, gb: 1000 ** 3, gib: 1024 ** 3, tb: 1000 ** 4, tib: 1024 ** 4 };
  return factors[u] ? n * factors[u] : null;
};
const latestMetric = (series, resourceId) => {
  const matching = (Array.isArray(series) ? series : []).filter(item =>
    (item.labels || []).some(label => ['service', 'resource'].includes(label.field) && label.value === resourceId)
  );
  const points = matching.flatMap(item => (item.values || []).map(point => ({ ...point, unit: point.unit || item.unit || null })))
    .filter(point => Number.isFinite(Number(point.value)))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return points[0] || null;
};
async function renderMetric(metric, resourceIds, startTime, endTime) {
  if (!resourceIds.length) return [];
  const params = new URLSearchParams({ startTime, endTime, resolutionSeconds: '60' });
  resourceIds.forEach(id => params.append('resource', id));
  return renderRequest(`/metrics/${metric}?${params.toString()}`);
}
async function listRenderServices() {
  if (!renderConfigured()) return [];
  let cursor = null;
  const entries = [];
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const result = await renderRequest(`/services?${query.toString()}`);
    const pageItems = Array.isArray(result) ? result : (result?.services || result?.items || []);
    entries.push(...pageItems);
    cursor = Array.isArray(result) ? (pageItems[pageItems.length - 1]?.cursor || null) : (result?.cursor || null);
    if (!cursor || !pageItems.length) break;
  }
  const resources = entries.map(normaliseRenderService).filter(item => item.id);
  const ids = resources.map(item => item.id);
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const [cpuResult, memoryResult, bandwidthResult] = await Promise.allSettled([
    renderMetric('cpu', ids, start.toISOString(), end.toISOString()),
    renderMetric('memory', ids, start.toISOString(), end.toISOString()),
    renderMetric('bandwidth', ids, start.toISOString(), end.toISOString())
  ]);
  const metricStatus = { cpu: cpuResult.status, memory: memoryResult.status, bandwidth: bandwidthResult.status };
  return resources.map(resource => {
    const cpu = cpuResult.status === 'fulfilled' ? latestMetric(cpuResult.value, resource.id) : null;
    const memory = memoryResult.status === 'fulfilled' ? latestMetric(memoryResult.value, resource.id) : null;
    const bandwidth = bandwidthResult.status === 'fulfilled' ? latestMetric(bandwidthResult.value, resource.id) : null;
    const memoryBytes = memory ? unitBytes(memory.value, memory.unit) : null;
    const outboundBytes = bandwidth ? unitBytes(bandwidth.value, bandwidth.unit) : null;
    return {
      ...resource,
      usage: {
        cpu: cpu ? Number(cpu.value) : null,
        cpuUnit: cpu?.unit || null,
        memoryBytes,
        memoryUnit: memory?.unit || null,
        memoryLimitBytes: null,
        outboundBytes,
        bandwidthUnit: bandwidth?.unit || null,
        bandwidthWindow: bandwidth ? 'Latest Render API data point (hourly metric)' : null,
        diskBytes: null,
        observedAt: [cpu?.timestamp, memory?.timestamp, bandwidth?.timestamp].filter(Boolean).sort().at(-1) || null,
        metricsStatus: metricStatus,
        source: 'Render native Metrics API (CPU, memory and outbound bandwidth)'
      }
    };
  });
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
      liveRenderMetrics: renderConfigured(),
      note: 'Render CPU, memory and bandwidth are read from the native Render Metrics API. Additional cloud providers implement the same normalized adapter contract; missing samples remain unreported.'
    },
    providerAdapterContract: ['render', 'aws', 'azure', 'gcp'],
    databaseAdapters: ['mongodb', 'atlas']
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
