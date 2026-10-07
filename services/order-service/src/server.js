import { randomUUID } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { config, validateConfig } from './config.js';
import routes from './routes.js';
import { Order, OrderEvent } from './models.js';
import { reconcilePendingPrescriptionOrders } from './orders.js';

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
  res.on('finish', () => console.info(JSON.stringify({
    serviceName: 'order-service',
    requestId: req.requestId,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode
  })));
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'order-service' }));
app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    database: ready ? 'connected' : 'disconnected'
  });
});
app.use('/api/v1/orders', routes);
app.use((error, req, res, _next) => {
  const status = error.statusCode
    || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500);
  if (status >= 500) console.error(JSON.stringify({
    serviceName: 'order-service',
    requestId: req.requestId,
    correlationId: req.correlationId,
    error: error.message
  }));
  return res.status(status).json({
    message: status >= 500 ? 'Order operation failed.' : error.message,
    requestId: req.requestId
  });
});

await mongoose.connect(config.mongoUri, {
  dbName: config.dbName,
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 20
});
await Promise.all([Order.init(), OrderEvent.init()]);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(`Order Service listening on port ${config.port}`);
});

let reconciliationTimer = null;
let reconciliationRunning = false;

const runPrescriptionReconciliation = async () => {
  if (!config.prescriptionServiceUrl || reconciliationRunning) return;
  reconciliationRunning = true;
  try {
    const result = await reconcilePendingPrescriptionOrders({
      limit: config.prescriptionReconciliationBatchSize
    });
    if (result.processed > 0) {
      console.info(JSON.stringify({
        serviceName: 'order-service',
        operation: 'prescription-reconciliation',
        ...result
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      serviceName: 'order-service',
      operation: 'prescription-reconciliation',
      error: error.message
    }));
  } finally {
    reconciliationRunning = false;
  }
};

if (config.prescriptionServiceUrl) {
  reconciliationTimer = setInterval(runPrescriptionReconciliation, config.prescriptionReconciliationIntervalMs);
  reconciliationTimer.unref?.();
  void runPrescriptionReconciliation();
}

const shutdown = async () => {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  server.close();
  await mongoose.disconnect();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
