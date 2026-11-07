import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { config, validateConfig } from './config.js';
import routes from './routes.js';
import stagedImportRoutes from './staged-import-routes.js';
import { StagedImportBatch, StagedImportRow } from './staged-import-models.js';
import { Audit, ImportBatch, ImportBatchSnapshot, ImportFailure, ImportJob, Inventory, Product, Reservation } from './models.js';

validateConfig();
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const suppliedRequestId = req.get('x-request-id') || '';
  const suppliedCorrelationId = req.get('x-correlation-id') || '';
  req.requestId = /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
  req.correlationId = /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedCorrelationId) ? suppliedCorrelationId : req.requestId;
  res.set('X-Request-Id', req.requestId);
  res.set('X-Correlation-Id', req.correlationId);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  const allowedOrigins = new Set([
    config.corsOrigin,
    'https://pharma-ui.onrender.com'
  ].filter(Boolean));
  if (origin && allowedOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,X-Request-Id,X-Correlation-Id,X-Tenant-Id,X-Branch-Id,X-Gateway-Authorization');
    return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
  }
  res.on('finish', () => {
    if (process.env.LOGGING_ENABLED === 'false') return;
    console.info(JSON.stringify({
      serviceName: 'inventory-service',
      requestId: req.requestId,
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode
    }));
  });
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'inventory-service' }));
app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready', database: ready ? 'connected' : 'disconnected' });
});
// Staged import routes are mounted first so uploads are stored for review only.
// Live catalogue and stock writes happen exclusively through explicit publish actions.
app.use('/api/v1/inventory', stagedImportRoutes);
app.use('/api/v1/inventory', routes);
app.use((error, req, res, _next) => {
  const status = error.statusCode
    || (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) {
    console.error(JSON.stringify({
      serviceName: 'inventory-service',
      requestId: req.requestId,
      correlationId: req.correlationId,
      error: error.message
    }));
  }
  return res.status(status).json({
    message: status >= 500 ? 'Inventory operation failed.' : error.message,
    requestId: req.requestId
  });
});

await mongoose.connect(config.mongoUri, {
  dbName: config.dbName,
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 20
});
await Promise.all([
  Product.init(),
  Inventory.init(),
  Reservation.init(),
  ImportJob.init(),
  ImportBatch.init(),
  StagedImportBatch.init(),
  StagedImportRow.init(),
  ImportBatchSnapshot.init(),
  ImportFailure.init(),
  Audit.init()
]);
// Mark abandoned staging requests as failed after a restart; rows remain available for inspection.
await StagedImportBatch.updateMany({ status: 'STAGING', updatedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) } }, {
  $set: { status: 'FAILED' }
});
// The legacy immediate-write import worker is intentionally not started.
// All new uploads use the staged batch workflow and require explicit publish.

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(`Inventory Service listening on port ${config.port}`);
});

const shutdown = async () => {
  server.close();
  await mongoose.disconnect();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
