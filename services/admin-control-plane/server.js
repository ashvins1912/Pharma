import 'dotenv/config';

// The standalone admin process may use its own deployment secret name.
// Existing admin route models currently share the platform database contract;
// point ADMIN_MONGO_URI at the same logical database until a domain is migrated
// to an independently-owned admin datastore.
if (process.env.ADMIN_MONGO_URI) process.env.MONGO_URI = process.env.ADMIN_MONGO_URI;

const [
  expressModule, cookieParserModule, mongooseModule,
  envModule, dbModule, contextModule, corsModule, headersModule,
  tenantsModule, featureHealthModule, serviceLogsModule, cleanupModule,
  infrastructureModule, infrastructureSecurityModule, devOpsModule,
  whatsappModule, riderAdminModule, assignmentAdminModule, paymentReminderModule, medicineRequestModule
] = await Promise.all([
  import('express'), import('cookie-parser'), import('mongoose'),
  import('../../backend/config/env.js'), import('../../backend/config/db.js'),
  import('../../backend/middleware/context.js'), import('../../backend/security/corsPolicy.js'),
  import('../../backend/security/securityHeaders.js'),
  import('../../backend/gateway/routes/adminTenants.js'),
  import('../../backend/gateway/routes/adminFeatureHealth.js'),
  import('../../backend/gateway/routes/adminServiceLogs.js'),
  import('../../backend/gateway/routes/adminDatabaseCleanup.js'),
  import('../../backend/gateway/routes/adminInfrastructure.js'),
  import('../../backend/gateway/routes/adminInfrastructureSecurity.js'),
  import('../../backend/gateway/routes/adminDevOps.js'),
  import('../../backend/routes/whatsappRoutes.js'),
  import('../../backend/modules/delivery/routes/riderRoutes.js'),
  import('../../backend/modules/delivery/routes/assignmentRoutes.js'),
  import('../../backend/routes/adminPaymentReminderRoutes.js'),
  import('../../backend/routes/medicineRequestRoutes.js')
]);

const express = expressModule.default;
const cookieParser = cookieParserModule.default;
const mongoose = mongooseModule.default;
const { env } = envModule;
const connectDB = dbModule.default;
const { contextMiddleware } = contextModule;
const { createCorsMiddleware, corsErrorHandler } = corsModule;
const { applySecurityHeaders } = headersModule;

if (env.NODE_ENV === 'production' && !env.MONGO_URI) {
  throw new Error('ADMIN_MONGO_URI (or MONGO_URI) is required for the standalone admin service.');
}
if (env.NODE_ENV === 'production' && process.env.REQUIRE_GATEWAY_TRUST !== 'true') {
  throw new Error('Standalone production admin service requires REQUIRE_GATEWAY_TRUST=true.');
}

const app = express();
const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',').map(value => value.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use((req, res, next) => applySecurityHeaders(req, res, next, { production: env.NODE_ENV === 'production' }));
app.use(createCorsMiddleware(allowedOrigins.length ? allowedOrigins : ['http://localhost:3000', 'http://localhost:5173']));
app.use(corsErrorHandler);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(contextMiddleware);

app.get('/health', (_req, res) => res.json({
  success: true, service: 'admin-control-plane', status: 'UP',
  database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  timestamp: new Date().toISOString()
}));
app.get('/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({
    success: ready, service: 'admin-control-plane',
    status: ready ? 'READY' : 'WAITING_FOR_DATABASE',
    database: ready ? 'connected' : 'disconnected'
  });
});

// These routers retain their existing Super Admin authentication and policy
// middleware. Security routes must be mounted before the broader infrastructure
// router so they are never shadowed by provider resource routes.
app.use('/api/v1/admin/infrastructure/security', infrastructureSecurityModule.default);
app.use('/api/v1/admin/devops', devOpsModule.default);
app.use('/api/v1/admin/infrastructure', infrastructureModule.default);
app.use('/api/v1/admin/tenants', tenantsModule.default);
app.use('/api/v1/admin/feature-health', featureHealthModule.default);
app.use('/api/v1/admin/service-logs', serviceLogsModule.default);
app.use('/api/v1/admin/database-cleanup/notifications', cleanupModule.default);
app.use('/api/v1/admin/payments', paymentReminderModule.default);
// Existing browser clients still call these legacy paths; preserve them during migration.
app.use('/api/admin/whatsapp', whatsappModule.default);
app.use('/api/admin/riders', riderAdminModule.default);
app.use('/api/admin/assignment', assignmentAdminModule.default);
app.use('/api/admin/payments', paymentReminderModule.default);
app.use('/api/admin/medicine-requests', medicineRequestModule.default);

app.use((error, _req, res, _next) => {
  const status = Number(error.status || error.statusCode || 500);
  if (status >= 500) console.error('[admin-control-plane] Request failed:', error.message);
  return res.status(status).json({
    success: false,
    error: { code: error.code || 'ADMIN_SERVICE_ERROR', message: status >= 500 ? 'Admin service request failed.' : error.message }
  });
});

const start = async () => {
  const connected = await connectDB();
  if (!connected && env.NODE_ENV === 'production') {
    throw new Error('Admin service cannot start without its configured MongoDB database.');
  }
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.info(`Admin Control Plane listening on port ${env.PORT}`);
  });
  const shutdown = signal => {
    console.info(`Admin Control Plane received ${signal}; shutting down.`);
    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};

start().catch(error => {
  console.error('[admin-control-plane] Startup failed:', error.message);
  process.exit(1);
});
