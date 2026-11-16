import mongoose from 'mongoose';
import { config } from '../src/config.js';

if (!config.mongoUri) throw new Error('INVENTORY_MONGO_URI is required.');
await mongoose.connect(config.mongoUri, { dbName: config.dbName, serverSelectionTimeoutMS: 10000 });
try {
  const reservations = mongoose.connection.collection('inventoryreservations');
  const indexes = await reservations.indexes();
  const legacy = indexes.find(index => index.name === 'idempotencyKey_1');
  // Create the correctly scoped unique index before removing the legacy global
  // unique index, so the collection never has an unprotected write window.
  await reservations.createIndex(
    { tenantId: 1, branchId: 1, idempotencyKey: 1 },
    { unique: true, name: 'tenant_branch_idempotency_unique' }
  );
  if (legacy) await reservations.dropIndex('idempotencyKey_1');
  console.info('Reservation idempotency index migration completed.');
} finally {
  await mongoose.disconnect();
}
