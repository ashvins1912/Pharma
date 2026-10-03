import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { proxyRequest } from './proxy.js';
import { createServiceRouters } from './serviceRoutes.js';
import { authenticateUser, requireAdmin } from './authenticateUser.js';
import { createHealthMonitor } from './healthMonitor.js';

export function createGatewayApp(gatewayConfig = config, healthMonitor = createHealthMonitor({
  services: gatewayConfig.healthServices || [],
  intervalMs: gatewayConfig.healthCheckIntervalMs,
  timeoutMs: gatewayConfig.healthCheckTimeoutMs,
  enabled: gatewayConfig.healthCheckEnabled,
  runOnStartup: gatewayConfig.healthCheckRunOnStartup
})) {
  const target = new URL(`${gatewayConfig.backendApiUrl}/ready`);
  const transport = target.protocol === 'https:' ? https : http;
  const { inventoryRouter, orderRouter } = createServiceRouters(gatewayConfig);
  const app = express();
  app.locals.healthMonitor = healthMonitor;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const suppliedRequestId = req.get('x-request-id') || '';
    const suppliedCorrelationId = req.get('x-correlation-id') || '';
    const isValidId = value => /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
    req.requestId = isValidId(suppliedRequestId) ? suppliedRequestId : randomUUID();
    req.correlationId = isValidId(suppliedCorrelationId) ? suppliedCorrelationId : req.requestId;
    res.set('X-Request-Id', req.requestId);
    res.set('X-Correlation-Id', req.correlationId);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin || gatewayConfig.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(Object.assign(new Error('Request origin is not allowed.'), {
        code: 'CORS_ORIGIN_NOT_ALLOWED'
      }));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-ID',
      'X-Correlation-ID',
      'X-XSRF-TOKEN',
      'X-CSRF-TOKEN'
    ],
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
    maxAge: 600,
    optionsSuccessStatus: 204
  }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api-gateway' }));
  app.get('/health/services',
    (req, res, next) => authenticateUser(req, res, next, gatewayConfig),
    requireAdmin,
    (req, res) => res.json({ ...healthMonitor.snapshot(), requestId: req.requestId })
  );
  app.get('/ready', (_req, res) => {
    const probe = transport.get(target, { timeout: 3000 }, response => {
      response.resume();
      const ready = response.statusCode >= 200 && response.statusCode < 300;
      res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not-ready',
        backend: ready ? 'ready' : 'unavailable'
      });
    });
    probe.on('timeout', () => probe.destroy(Object.assign(
      new Error('Readiness probe timed out.'),
      { code: 'ETIMEDOUT' }
    )));
    probe.on('error', error => {
      console.warn('API Gateway backend readiness probe failed:', { code: error.code || error.name });
      if (!res.headersSent) res.status(503).json({ status: 'not-ready', backend: 'unavailable' });
    });
  });

  app.use('/api/v1/inventory', inventoryRouter);
  app.use('/api/v1/orders', orderRouter);
  app.use('/api', (req, res) => proxyRequest(
    req,
    res,
    gatewayConfig.backendApiUrl,
    null,
    gatewayConfig
  ));
  app.use((req, res) => res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route was not found.' },
    requestId: req.requestId
  }));
  app.use((error, req, res, _next) => {
    if (error.code === 'CORS_ORIGIN_NOT_ALLOWED') {
      console.warn('Rejected cross-origin request:', {
        requestId: req.requestId,
        origin: req.get('origin') || null
      });
      return res.status(403).json({
        success: false,
        error: { code: 'CORS_ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed.' },
        requestId: req.requestId
      });
    }
    console.error('API Gateway request failed:', {
      requestId: req.requestId,
      code: error.code || error.name
    });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal gateway error.' },
      requestId: req.requestId
    });
  });

  return app;
}

export default createGatewayApp();
