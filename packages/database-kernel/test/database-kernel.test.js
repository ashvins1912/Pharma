import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPostgresDatabaseAdapter,
  createServiceDatabase,
  resolveServiceDatabaseConfig
} from '../src/index.js';

test('service registry resolves legacy Mongo settings without changing existing deployments', () => {
  const config = resolveServiceDatabaseConfig({
    serviceName: 'inventory-service',
    env: { INVENTORY_MONGO_URI: 'mongodb://localhost:27017', INVENTORY_DB_NAME: 'inventory_test' }
  });
  assert.equal(config.provider, 'mongodb');
  assert.equal(config.uri, 'mongodb://localhost:27017');
  assert.equal(config.database, 'inventory_test');
});

test('service-specific provider selection takes precedence over global provider', () => {
  const config = resolveServiceDatabaseConfig({
    serviceName: 'order-service',
    env: { DATABASE_PROVIDER: 'postgresql', ORDER_DATABASE_PROVIDER: 'mongodb', ORDER_MONGO_URI: 'mongodb://localhost:27017' }
  });
  assert.equal(config.provider, 'mongodb');
});

test('unmigrated services fail closed when PostgreSQL is selected', () => {
  assert.throws(() => resolveServiceDatabaseConfig({
    serviceName: 'order-service',
    provider: 'postgresql',
    env: { ORDER_DATABASE_URL: 'postgres://localhost/orders' }
  }), /repository\/use-case migration is not complete/);
});

test('unknown service registrations fail closed', () => {
  assert.throws(() => resolveServiceDatabaseConfig({ serviceName: 'unknown-service', env: {} }), /No database ownership\/adapter registration/);
});

test('Mongo runtime factory preserves the existing Mongoose connection path', async () => {
  const calls = [];
  const mongoose = {
    connection: { readyState: 0 },
    async connect(uri, options) { calls.push({ uri, options }); this.connection.readyState = 1; },
    async disconnect() { this.connection.readyState = 0; }
  };
  const db = createServiceDatabase({
    serviceName: 'order-service',
    mongoose,
    env: { ORDER_MONGO_URI: 'mongodb://localhost:27017' },
    mongoOptions: { maxPoolSize: 7 }
  });
  await db.connect();
  assert.equal(db.isReady(), true);
  assert.equal(calls[0].options.dbName, 'pharma_orders');
  assert.equal(calls[0].options.maxPoolSize, 7);
  await db.disconnect();
  assert.equal(db.isReady(), false);
});

test('PostgreSQL adapter commits successful transactions and releases clients', async () => {
  const clientCalls = [];
  let released = false;
  class FakePool {
    constructor() {}
    async query() { return { rows: [{ ok: 1 }] }; }
    async connect() {
      return {
        async query(sql, values) { clientCalls.push({ sql, values }); return { rows: [] }; },
        release() { released = true; }
      };
    }
    async end() {}
  }
  const db = createPostgresDatabaseAdapter({ Pool: FakePool, connectionString: 'postgres://localhost/test' });
  await db.connect();
  const result = await db.withTransaction(async tx => {
    await tx.query('UPDATE stock SET quantity = $1 WHERE id = $2', [3, 'row-1']);
    return 'committed';
  });
  assert.equal(result, 'committed');
  assert.deepEqual(clientCalls.map(x => x.sql), ['BEGIN', 'UPDATE stock SET quantity = $1 WHERE id = $2', 'COMMIT']);
  assert.equal(released, true);
  await db.disconnect();
});

test('PostgreSQL adapter rolls back failed transactions and rethrows the original error', async () => {
  const clientCalls = [];
  let released = false;
  class FakePool {
    async query() { return { rows: [] }; }
    async connect() {
      return {
        async query(sql) { clientCalls.push(sql); },
        release() { released = true; }
      };
    }
    async end() {}
  }
  const db = createPostgresDatabaseAdapter({ Pool: FakePool, connectionString: 'postgres://localhost/test' });
  await db.connect();
  const failure = new Error('constraint failure');
  await assert.rejects(db.withTransaction(async () => { throw failure; }), error => error === failure);
  assert.deepEqual(clientCalls, ['BEGIN', 'ROLLBACK']);
  assert.equal(released, true);
  await db.disconnect();
});
