import 'dotenv/config';

const positiveInteger = (value, fallback, max) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const config = {
  port: positiveInteger(process.env.PORT, 5101, 65535),
  mongoUri: process.env.MEDICINE_MASTER_MONGO_URI || process.env.INVENTORY_MONGO_URI,
  mongoMaxPoolSize: positiveInteger(process.env.MONGO_MAX_POOL_SIZE, 10, 50),
  dbName: process.env.MEDICINE_MASTER_DB_NAME || process.env.INVENTORY_DB_NAME || 'pharma_inventory',
  serviceAuthSecret: process.env.SERVICE_AUTH_SECRET || '',
  serviceJwtIssuer: process.env.SERVICE_JWT_ISSUER || 'ashvin-pharmacy',
  serviceJwtAudience: process.env.MEDICINE_MASTER_SERVICE_JWT_AUDIENCE || 'medicine-master-service',
  maxUploadBytes: positiveInteger(process.env.MEDICINE_MASTER_IMPORT_MAX_FILE_BYTES, 110 * 1024 * 1024, 110 * 1024 * 1024),
  loggingEnabled: process.env.LOGGING_ENABLED !== 'false'
};

export function validateConfig() {
  const errors = [];
  if (!config.mongoUri || !(config.mongoUri.startsWith('mongodb://') || config.mongoUri.startsWith('mongodb+srv://'))) {
    errors.push('MEDICINE_MASTER_MONGO_URI (or INVENTORY_MONGO_URI) must be a MongoDB connection URI.');
  }
  if (!config.serviceAuthSecret || config.serviceAuthSecret.length < 32) {
    errors.push('SERVICE_AUTH_SECRET must contain at least 32 characters.');
  }
  if (errors.length) throw new Error(errors.join(' '));
}
