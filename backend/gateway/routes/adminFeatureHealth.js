/**
 * Admin Feature Health & RBAC Governance Router (/api/v1/admin/feature-health)
 * Strictly restricted to Platform Super Admin.
 * Provides continuous RBAC validation, microservice health signals, regression detection,
 * and canonical Blocker Intelligence (8 taxonomy classes, P0-P3 severity).
 */
import express from 'express';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import { runRbacValidationSuite, CORE_FEATURES, MASTER_ROLES } from '../../../tests/security/rbac/rbacEngine.js';

const router = express.Router();

// Strict platform superadmin gate
router.use(authenticateUser, requireSuperAdmin);

// Upstream microservices monitored
export const MONITORED_SERVICES = [
  {
    id: 'api-gateway',
    name: 'Pharma API Gateway',
    url: 'https://pharma-api-gateway.onrender.com/health',
    required: true,
    category: 'GATEWAY'
  },
  {
    id: 'caching-service',
    name: 'Caching & Session Service',
    url: 'https://caching-v0et.onrender.com/health',
    required: true,
    category: 'CACHE'
  },
  {
    id: 'inventory-service',
    name: 'Inventory & Stock Service',
    url: 'https://inventory-axkq.onrender.com/health',
    required: true,
    category: 'INVENTORY'
  },
  {
    id: 'pharma-core-api',
    name: 'Pharma Core API & Catalog',
    url: 'https://pharma-api-j5j1.onrender.com/ready',
    fallbackUrl: 'https://pharma-api-j5j1.onrender.com/health',
    required: true,
    category: 'CORE'
  },
  {
    id: 'prescription-service',
    name: 'Prescription & Verification Service',
    url: 'https://prescription-service-sg6m.onrender.com/health',
    required: true,
    category: 'PRESCRIPTION'
  },
  {
    id: 'websocket-service',
    name: 'Real-Time WebSocket & Activity Hub',
    url: 'https://websockt.onrender.com/health',
    required: true,
    category: 'SOCKET'
  }
];

let cachedServiceHealth = null;
let lastProbeTimestamp = null;

async function probeService(service, timeoutMs = 60000) {
  const start = Date.now();
  try {
    const targetUrl = service.url;
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const latency = Date.now() - start;
    const ok = response.ok;
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = { rawStatus: response.statusText };
    }

    return {
      id: service.id,
      name: service.name,
      url: service.url,
      category: service.category,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      httpStatus: response.status,
      latencyMs: latency,
      healthy: ok,
      lastChecked: new Date().toISOString(),
      details: data
    };
  } catch (err) {
    const latency = Date.now() - start;
    return {
      id: service.id,
      name: service.name,
      url: service.url,
      category: service.category,
      status: 'OFFLINE',
      httpStatus: 0,
      latencyMs: latency,
      healthy: false,
      lastChecked: new Date().toISOString(),
      error: err.name === 'TimeoutError' ? 'Probe timed out (60s)' : err.message
    };
  }
}

async function probeAllServices(timeoutMs = 15000) {
  const results = await Promise.all(MONITORED_SERVICES.map(s => probeService(s, timeoutMs)));
  cachedServiceHealth = results;
  lastProbeTimestamp = new Date().toISOString();
  return results;
}

let cachedRbacReport = null;
let lastRbacTimestamp = 0;
let rbacReportInFlight = null;
const RBAC_CACHE_TTL_MS = 30000;

async function getRbacReport({ fresh = false } = {}) {
  if (!fresh && cachedRbacReport && Date.now() - lastRbacTimestamp < RBAC_CACHE_TTL_MS) {
    return cachedRbacReport;
  }
  if (!fresh && rbacReportInFlight) return rbacReportInFlight;

  const run = runRbacValidationSuite()
    .then(report => {
      cachedRbacReport = report;
      lastRbacTimestamp = Date.now();
      return report;
    })
    .finally(() => {
      if (rbacReportInFlight === run) rbacReportInFlight = null;
    });

  rbacReportInFlight = run;
  return run;
}

function buildHealthData(rbacReport, serviceHealth) {
  const canonicalBlockers = [...rbacReport.blockers];
  for (const service of serviceHealth) {
    if (!service.healthy) {
      canonicalBlockers.push({
        id: `BLK-SRV-${service.id}`,
        category: 'SERVICE_BLOCKER',
        severity: service.required ? 'P0' : 'P1',
        feature: service.name,
        role: 'ALL',
        tenant: 'GLOBAL',
        serviceUrl: service.url,
        message: `Dependent microservice ${service.name} is ${service.status}: ${service.error || `HTTP ${service.httpStatus}`}`,
        recommendedAction: `Inspect deployment logs on Render for ${service.name} and verify environment variables.`
      });
    }
  }

  const severityCounts = Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map(severity => [
    severity, canonicalBlockers.filter(blocker => blocker.severity === severity).length
  ]));
  const categories = [
    'RBAC_BLOCKER', 'TENANT_ISOLATION_BLOCKER', 'AUTHENTICATION_BLOCKER', 'API_BLOCKER',
    'DATABASE_BLOCKER', 'SERVICE_BLOCKER', 'UI_BLOCKER', 'BUSINESS_WORKFLOW_BLOCKER'
  ];
  const categoryCounts = Object.fromEntries(categories.map(category => [
    category, canonicalBlockers.filter(blocker => blocker.category === category).length
  ]));

  const totalServices = serviceHealth.length;
  const healthyServices = serviceHealth.filter(service => service.healthy).length;
  const rbacPassRate = rbacReport.totalChecks > 0 ? (rbacReport.passedChecks / rbacReport.totalChecks) * 100 : 100;
  const servicePassRate = totalServices > 0 ? (healthyServices / totalServices) * 100 : 100;
  const healthScore = Math.round((rbacPassRate * 0.6) + (servicePassRate * 0.4));

  return {
    timestamp: new Date().toISOString(),
    healthScore,
    systemStatus: healthScore >= 90 ? 'HEALTHY' : (healthScore >= 70 ? 'DEGRADED' : 'CRITICAL'),
    summary: {
      totalRolesChecked: MASTER_ROLES.length,
      totalFeaturesTested: CORE_FEATURES.length,
      totalRbacChecks: rbacReport.totalChecks,
      passedRbacChecks: rbacReport.passedChecks,
      failedRbacChecks: rbacReport.failedChecks,
      totalBlockers: canonicalBlockers.length,
      severityCounts,
      categoryCounts
    },
    services: serviceHealth,
    matrix: {
      roles: MASTER_ROLES,
      features: CORE_FEATURES.map(feature => ({
        id: feature.id,
        name: feature.name,
        endpoint: feature.endpoint,
        method: feature.method,
        requiredPermission: feature.requiredPermission,
        requiredScope: feature.requiredScope,
        results: rbacReport.matrixResults[feature.id] || {}
      }))
    },
    blockers: canonicalBlockers
  };
}

/**
 * GET /api/v1/admin/feature-health
 * Complete RBAC validation matrix, microservice health, and blocker intelligence audit
 */
router.get('/', async (req, res, next) => {
  try {
    const fresh = req.query.fresh === 'true';
    const rbacReport = await getRbacReport({ fresh });
    const shouldRefreshServices = fresh || !cachedServiceHealth
      || (Date.now() - new Date(lastProbeTimestamp || 0).getTime() > 120000);
    const serviceHealth = shouldRefreshServices ? await probeAllServices(8000) : cachedServiceHealth;

    res.json({ success: true, data: buildHealthData(rbacReport, serviceHealth) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/feature-health/probe-services
 * Explicit on-demand probe of all microservices with full timeout tolerance (up to 60s)
 */
router.post('/probe-services', async (req, res, next) => {
  try {
    const timeout = req.body?.timeoutMs ? Math.min(Number(req.body.timeoutMs), 60000) : 60000;
    const serviceHealth = await probeAllServices(timeout);
    res.json({
      success: true,
      timestamp: lastProbeTimestamp,
      count: serviceHealth.length,
      healthyCount: serviceHealth.filter(s => s.healthy).length,
      services: serviceHealth
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/feature-health/run-audit
 * Force execution of full RBAC regression suite and return actionable intelligence
 */
router.post('/run-audit', async (req, res, next) => {
  try {
    const rbacReport = await getRbacReport({ fresh: true });
    const serviceHealth = await probeAllServices(8000);
    res.json({ success: true, data: buildHealthData(rbacReport, serviceHealth) });
  } catch (err) {
    next(err);
  }
});


/**
 * GET/POST /api/v1/admin/feature-health/probe-service
 * Probe a specific single microservice from the backend (no browser CORS restrictions)
 */
async function handleSingleServiceProbe(req, res, next) {
  try {
    const serviceId = req.query.serviceId || req.body?.serviceId;
    const customUrl = req.query.url || req.body?.url;
    const timeout = Math.min(Number(req.query.timeoutMs || req.body?.timeoutMs || 60000), 60000);

    const service = MONITORED_SERVICES.find(s => s.id === serviceId) || {
      id: serviceId || 'custom_service',
      name: serviceId || 'Custom Service',
      url: customUrl || 'https://pharma-api-gateway.onrender.com/health',
      category: 'CUSTOM'
    };

    if (customUrl) service.url = customUrl;

    const probe = await probeService(service, timeout);
    const payloadStr = probe.details ? (typeof probe.details === 'string' ? probe.details : JSON.stringify(probe.details)) : '';

    res.json({
      success: true,
      serviceId: service.id,
      name: service.name,
      url: service.url,
      status: probe.healthy ? 'ONLINE' : 'TIMEOUT_OFFLINE',
      statusCode: probe.httpStatus,
      latencyMs: probe.latencyMs,
      healthy: probe.healthy,
      lastChecked: probe.lastChecked,
      payload: payloadStr,
      error: probe.error || null
    });
  } catch (err) {
    next(err);
  }
}

router.get('/probe-service', handleSingleServiceProbe);
router.post('/probe-service', handleSingleServiceProbe);

export { probeAllServices, probeService };
export default router;
