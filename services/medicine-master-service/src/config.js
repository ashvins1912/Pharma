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
  vectorSearchEnabled: process.env.MEDICINE_VECTOR_SEARCH_ENABLED === 'true',
  vectorModel: process.env.MEDICINE_VECTOR_MODEL || 'onnx-community/all-MiniLM-L6-v2-ONNX',
  vectorDimensions: positiveInteger(process.env.MEDICINE_VECTOR_DIMENSIONS, 384, 4096),
  vectorCollection: process.env.MEDICINE_VECTOR_COLLECTION || 'medicine_master_vector_index',
  vectorStateCollection: process.env.MEDICINE_VECTOR_STATE_COLLECTION || 'medicine_master_vector_sync_state',
  vectorIndex: process.env.MEDICINE_VECTOR_INDEX || 'medicine_master_vector_idx',
  vectorSyncIntervalMs: positiveInteger(process.env.MEDICINE_VECTOR_SYNC_INTERVAL_MS, 30000, 3600000),
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
