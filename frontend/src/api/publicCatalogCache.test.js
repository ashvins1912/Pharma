import test from 'node:test';
import assert from 'node:assert/strict';
import { getCachedPublicCatalog, invalidatePublicCatalogCache } from './publicCatalogCache.js';

test('caches only the exact public catalog query for a short TTL', async () => {
  invalidatePublicCatalogCache();
  let calls = 0;
  const client = { async get(_url, { params }) { calls += 1; return { data: { params, medicines: [] } }; } };
  await getCachedPublicCatalog(client, '/api/medicines', { page: 1, limit: 16 });
  await getCachedPublicCatalog(client, '/api/medicines', { limit: 16, page: 1 });
  await getCachedPublicCatalog(client, '/api/medicines', { page: 2, limit: 16 });
  assert.equal(calls, 2);
});

test('deduplicates concurrent identical requests', async () => {
  invalidatePublicCatalogCache();
  let calls = 0;
  const client = { async get() { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { data: { medicines: [] } }; } };
  await Promise.all([
    getCachedPublicCatalog(client, '/api/medicines', { page: 1 }),
    getCachedPublicCatalog(client, '/api/medicines', { page: 1 })
  ]);
  assert.equal(calls, 1);
});
