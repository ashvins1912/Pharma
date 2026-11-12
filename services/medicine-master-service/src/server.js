import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { config, validateConfig } from './config.js';
import medicineCatalogueImportRoutes, { initializeMedicineCatalogueModels, stopMedicineCatalogueImportWorker } from './medicine-catalogue-import-routes.js';
import medicineCatalogueRoutes from './medicine-catalogue-routes.js';
import { initializeMedicineMatchReferenceModel, startMedicineMatchWorker, stopMedicineMatchWorker } from './medicine-match-reference.js';

validateConfig();
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const supplied = req.get('x-request-id') || '';
  req.requestId = /^[a-zA-Z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
  res.set('X-Request-Id', req.requestId);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'no-store');
  if (config.loggingEnabled) res.on('finish', () => console.info(JSON.stringify({
    serviceName: 'medicine-master-service', requestId: req.requestId,
    method: req.method, path: req.path, statusCode: res.statusCode
  })));
  next();
});
app.use(express.json({ limit: '8mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'medicine-master-service' }));
app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready', database: ready ? 'connected' : 'disconnected' });
});
app.use('/api/v1/inventory/catalogue/medicines', medicineCatalogueRoutes);
app.use('/api/v1/inventory/catalogue', medicineCatalogueImportRoutes);
app.use((error, req, res, _next) => {
  const tooLarge = error.type === 'entity.too.large' || error.status === 413
    || (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE');
  const status = error.statusCode || (tooLarge ? 413 : 500);
  if (status >= 500) console.error(JSON.stringify({
    serviceName: 'medicine-master-service', requestId: req.requestId,
    error: error.message
  }));
  res.status(status).json({
    code: tooLarge ? 'REQUEST_BODY_TOO_LARGE' : undefined,
    message: status >= 500 ? 'Medicine Master operation failed.' : (tooLarge ? 'The catalogue upload exceeds the configured size limit.' : error.message),
    requestId: req.requestId
  });
});

await mongoose.connect(config.mongoUri, {
  dbName: config.dbName, serverSelectionTimeoutMS: 10000,
  maxPoolSize: config.mongoMaxPoolSize, minPoolSize: 0, maxIdleTimeMS: 30_000
});
await Promise.all([initializeMedicineCatalogueModels(), initializeMedicineMatchReferenceModel()]);
startMedicineMatchWorker();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.info(`Medicine Master Service listening on port ${config.port}; database ${config.dbName}`);
});
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopMedicineCatalogueImportWorker();
  stopMedicineMatchWorker();
  await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
