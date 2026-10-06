try {
  require('dotenv').config();
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
  port: positiveInteger(process.env.PORT || process.env.INVENTORY_SERVICE_PORT, 5100, 65535),
  mongoUri: process.env.INVENTORY_MONGO_URI,
  dbName: process.env.INVENTORY_DB_NAME || 'pharma_inventory',
  serviceAuthSecret: process.env.SERVICE_AUTH_SECRET,
  serviceJwtIssuer: process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy',
  serviceJwtAudience: process.env.SERVICE_JWT_AUDIENCE || 'inventory-service',
  batchSize: positiveInteger(process.env.INVENTORY_BATCH_SIZE, 250, 1000),
  workerConcurrency: positiveInteger(process.env.INVENTORY_WORKER_CONCURRENCY, 1, 3),
  maxRetries: positiveInteger(process.env.INVENTORY_MAX_RETRIES, 3, 5),
  maxFileBytes: positiveInteger(process.env.INVENTORY_IMPORT_MAX_FILE_BYTES, 104857600, 104857600),
  importStorage: process.env.INVENTORY_IMPORT_STORAGE || './data/imports',
  reservationTTLHours: positiveInteger(process.env.INVENTORY_RESERVATION_TTL_HOURS, 24, 168),
  corsOrigin: process.env.INVENTORY_CORS_ORIGIN || ''
};

export function validateConfig() {
  const errors = [];
  if (!config.mongoUri || !/^mongodb(?:\+srv)?:\/\//.test(config.mongoUri)) {
    errors.push('INVENTORY_MONGO_URI must be a MongoDB URI for the dedicated Inventory database.');
  }
  if (!config.serviceAuthSecret || config.serviceAuthSecret.length < 32) {
    errors.push('SERVICE_AUTH_SECRET must contain at least 32 characters.');
  }
  if (errors.length) throw new Error(errors.join(' '));
}
