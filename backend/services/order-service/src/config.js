try {
  await import('dotenv/config');
} catch {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile();
    } catch {
      // In production (Render/Cloud), environment variables are already set in process.env
    }
  }
}

const positiveInteger = (value, fallback, max) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const config = {
  port: positiveInteger(process.env.PORT || process.env.ORDER_SERVICE_PORT, 5200, 65535),
  mongoUri: process.env.ORDER_MONGO_URI,
  dbName: process.env.ORDER_DB_NAME || 'pharma_orders',
  serviceAuthSecret: process.env.SERVICE_AUTH_SECRET,
  serviceJwtIssuer: process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy',
  serviceJwtAudience: process.env.ORDER_SERVICE_JWT_AUDIENCE || 'order-service',
  inventoryJwtAudience: process.env.SERVICE_JWT_AUDIENCE || 'inventory-service',
  inventoryServiceUrl: (process.env.INVENTORY_SERVICE_URL || '').replace(/\/+$/, ''),
  prescriptionServiceUrl: (process.env.PRESCRIPTION_SERVICE_URL || '').replace(/\/+$/, ''),
  prescriptionReconciliationIntervalMs: positiveInteger(process.env.PRESCRIPTION_RECONCILIATION_INTERVAL_MS, 10000, 300000),
  prescriptionReconciliationBatchSize: positiveInteger(process.env.PRESCRIPTION_RECONCILIATION_BATCH_SIZE, 20, 100)
};

export function validateConfig() {
  const errors = [];
  if (!config.mongoUri || !/^mongodb(?:\+srv)?:\/\//.test(config.mongoUri)) {
    errors.push('ORDER_MONGO_URI must be a MongoDB URI for the dedicated Order database.');
  }
  if (!config.serviceAuthSecret || config.serviceAuthSecret.length < 32) {
    errors.push('SERVICE_AUTH_SECRET must contain at least 32 characters.');
  }
  const production = process.env.NODE_ENV === 'production';
  if (production && !config.prescriptionServiceUrl) {
    errors.push('PRESCRIPTION_SERVICE_URL is required in production for prescription verification and reconciliation.');
  }
  if (errors.length) throw new Error(errors.join(' '));
}
