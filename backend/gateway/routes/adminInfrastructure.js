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
const metricPoints = (series, resourceId) => (Array.isArray(series) ? series : [])
  .filter(item => (item.labels || []).some(label => ['service', 'resource'].includes(label.field) && label.value === resourceId))
  .flatMap(item => (item.values || []).map(point => ({ ...point, unit: point.unit || item.unit || null })))
  .filter(point => Number.isFinite(Number(point.value)))
  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
const latestMetric = (series, resourceId) => metricPoints(series, resourceId).at(-1) || null;
const sumMetricBytes = (series, resourceId) => {
  const points = metricPoints(series, resourceId);
  if (!points.length) return null;
  const converted = points.map(point => unitBytes(point.value, point.unit));
  return converted.every(value => value !== null) ? converted.reduce((sum, value) => sum + value, 0) : null;
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
  const recentStart = new Date(end.getTime() - 60 * 60 * 1000);
  const dayStart = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const computeIds = resources.filter(resource => !['static_site', 'cron_job'].includes(resource.type)).map(resource => resource.id);
  const [cpuResult, memoryResult, bandwidthResult] = await Promise.allSettled([
    renderMetric('cpu', computeIds, recentStart.toISOString(), end.toISOString()),
    renderMetric('memory', computeIds, recentStart.toISOString(), end.toISOString()),
    renderMetric('bandwidth', ids, dayStart.toISOString(), end.toISOString())
  ]);
  const metricStatus = { cpu: cpuResult.status, memory: memoryResult.status, bandwidth: bandwidthResult.status };
  return resources.map(resource => {
    const cpu = cpuResult.status === 'fulfilled' ? latestMetric(cpuResult.value, resource.id) : null;
    const memory = memoryResult.status === 'fulfilled' ? latestMetric(memoryResult.value, resource.id) : null;
    const bandwidth = bandwidthResult.status === 'fulfilled' ? latestMetric(bandwidthResult.value, resource.id) : null;
    const memoryBytes = memory ? unitBytes(memory.value, memory.unit) : null;
    const outboundBytes = sumMetricBytes(bandwidthResult.status === 'fulfilled' ? bandwidthResult.value : [], resource.id);
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
        bandwidthWindow: bandwidth ? 'Total of available hourly points · last 24 hours' : null,
        diskBytes: null,
        estimatedCost: null, costCurrency: null, costWindow: null,
        observedAt: [cpu?.timestamp, memory?.timestamp, bandwidth?.timestamp].filter(Boolean).sort().at(-1) || null,
        metricsStatus: metricStatus,
        source: 'Render native Metrics API · CPU/memory latest sample; bandwidth summed from hourly points over 24 hours'
      }
    };
  });
}
const controlPlaneConfigured = () => Boolean(process.env.INFRASTRUCTURE_CONTROL_PLANE_URL);
const controlPlaneRequest = async (path, options = {}) => {
  const base = String(process.env.INFRASTRUCTURE_CONTROL_PLANE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('External infrastructure control plane is not configured.');
  const url = new URL(`${base}${path}`);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Infrastructure control plane must use HTTPS in production.');
  if (process.env.NODE_ENV === 'production' && !process.env.INFRASTRUCTURE_CONTROL_PLANE_TOKEN) throw new Error('Infrastructure control plane bearer token is required in production.');
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(process.env.INFRASTRUCTURE_CONTROL_PLANE_TOKEN ? { Authorization: `Bearer ${process.env.INFRASTRUCTURE_CONTROL_PLANE_TOKEN}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Infrastructure control plane returned HTTP ${response.status}: ${body.slice(0, 250)}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
};
async function listExternalResources() {
  if (!controlPlaneConfigured()) return [];
  const payload = await controlPlaneRequest('/v1/resources');
  const supported = new Set(['aws', 'azure', 'gcp']);
  return (Array.isArray(payload?.resources) ? payload.resources : []).filter(item =>
    item && typeof item.id === 'string' && supported.has(String(item.provider || '').toLowerCase())
  ).map(item => ({
    id: item.id, name: item.name || item.id, provider: String(item.provider).toLowerCase(),
    type: item.type || 'compute', region: item.region || null, plan: item.plan || null,
    status: item.status || 'UNKNOWN', dashboardUrl: item.dashboardUrl || null,
    capabilities: {
      start: item.capabilities?.start === true,
      stop: item.capabilities?.stop === true,
      restart: item.capabilities?.restart === true
    },
    usage: {
      cpu: item.usage?.cpu ?? null, cpuUnit: item.usage?.cpuUnit || null,
      memoryBytes: item.usage?.memoryBytes ?? null, memoryLimitBytes: item.usage?.memoryLimitBytes ?? null,
      outboundBytes: item.usage?.outboundBytes ?? null, bandwidthWindow: item.usage?.bandwidthWindow || null,
      diskBytes: item.usage?.diskBytes ?? null,
      estimatedCost: Number.isFinite(Number(item.usage?.estimatedCost)) ? Number(item.usage.estimatedCost) : null,
      costCurrency: /^[A-Z]{3}$/.test(String(item.usage?.costCurrency || '').toUpperCase()) ? String(item.usage.costCurrency).toUpperCase() : null,
      costWindow: typeof item.usage?.costWindow === 'string' ? item.usage.costWindow.slice(0, 80) : null,
      observedAt: item.usage?.observedAt || null,
      source: item.usage?.source || `${item.provider} metrics adapter`
    }
  }));
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
  if (controlPlaneConfigured()) {
    try {
      const external = await listExternalResources();
      providers.push({ id: 'external-clouds', name: 'AWS · Azure · GCP', status: 'CONNECTED', resources: external });
    } catch (error) {
      providers.push({ id: 'external-clouds', name: 'AWS · Azure · GCP', status: 'ERROR', error: error.message, resources: [] });
    }
  } else {
    providers.push({ id: 'external-clouds', name: 'AWS · Azure · GCP', status: 'NOT_CONFIGURED', message: 'Configure the generic infrastructure control-plane URL and token to connect AWS, Azure or GCP.' });
  }
  let mongo;
  try { mongo = await getMongoUsage(); }
  catch (error) { mongo = { configured: false, status: 'ERROR', message: error.message }; }
  res.set('Cache-Control', 'private, no-store');
  return res.json({
    success: true, checkedAt: new Date().toISOString(),
    providers, databases: [{ id: 'mongodb', provider: 'mongodb', name: 'MongoDB', ...mongo }],
    metrics: {
      liveRenderMetrics: renderConfigured(),
      note: 'Render CPU, memory and bandwidth are read from the native Render Metrics API. Additional cloud providers implement the same normalized adapter contract; missing samples remain unreported.'
    },
    providerAdapterContract: ['render', 'aws', 'azure', 'gcp'],
    databaseAdapters: ['mongodb', 'atlas']
  });
});
router.post('/resources/:resourceId/:action', async (req, res) => {
  const { resourceId, action } = req.params;
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Unsupported infrastructure lifecycle action.' });
  }
  const provider = String(req.body?.provider || 'render').toLowerCase();
  if (!['render', 'aws', 'azure', 'gcp'].includes(provider)) {
    return res.status(400).json({ success: false, message: 'Unsupported infrastructure provider.' });
  }
  if (req.body?.confirmation !== `${action.toUpperCase()} RESOURCE`) {
    return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: `Type ${action.toUpperCase()} RESOURCE to confirm.` });
  }
  try {
    let resource;
    if (provider === 'render') {
      if (!renderConfigured()) return res.status(503).json({ success: false, message: 'Render provider is not configured.' });
      const serviceResponse = await renderRequest(`/services/${encodeURIComponent(resourceId)}`);
      resource = normaliseRenderService(serviceResponse);
      if (!resource) return res.status(404).json({ success: false, message: 'Resource was not found in the configured Render workspace.' });
      if (!resource.capabilities[action]) return res.status(409).json({ success: false, message: `The ${action} action is not supported for this resource or current state.` });
      const endpoint = action === 'start' ? 'resume' : action === 'stop' ? 'suspend' : 'restart';
      await renderRequest(`/services/${encodeURIComponent(resourceId)}/${endpoint}`, { method: 'POST' });
    } else {
      if (!controlPlaneConfigured()) return res.status(503).json({ success: false, message: 'External cloud control plane is not configured.' });
      resource = (await listExternalResources()).find(item => item.id === resourceId && item.provider === provider);
      if (!resource) return res.status(404).json({ success: false, message: 'Resource was not found for the selected cloud provider.' });
      if (!resource.capabilities[action]) return res.status(409).json({ success: false, message: `The ${action} action is not supported for this resource or current state.` });
      await controlPlaneRequest(`/v1/resources/${encodeURIComponent(resourceId)}/actions`, {
        method: 'POST', body: JSON.stringify({ action, provider })
      });
    }
    const actor = req.user?.sub || req.user?.id || 'super-admin';
    console.info(JSON.stringify({ event: 'infrastructure_resource_lifecycle', provider, resourceId, action, actor, at: new Date().toISOString() }));
    return res.json({ success: true, provider, resourceId, action, acceptedAt: new Date().toISOString(), actor, message: 'Provider accepted the lifecycle request. Refresh status to verify the resulting state.' });
  } catch (error) {
    return res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
export default router;
