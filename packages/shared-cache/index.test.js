import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedCacheClient } from './index.js';

test('disables shared cache when its service token is misconfigured without crashing the process', async () => {
  const client = new SharedCacheClient({ baseUrl: 'http://localhost:8080', token: 'short' });
  assert.equal(client.enabled, false);
  await assert.rejects(client.get('key'), /at least 32 characters/);
});

test('encodes cache keys and sends the internal token', async () => {
  let seen;
  const client = new SharedCacheClient({
    baseUrl: 'http://localhost:8080/',
    token: 'a'.repeat(40),
    fetchImpl: async (url, options) => {
      seen = { url: String(url), options };
      return new Response(JSON.stringify({ hit: true, value: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.deepEqual(await client.get('catalog:tenant:1'), { ok: true });
  assert.match(seen.url, /key=catalog%3Atenant%3A1/);
  assert.equal(seen.options.headers['x-cache-service-token'], 'a'.repeat(40));
});

test('does not silently pretend a missing shared service is available', async () => {
  const client = new SharedCacheClient({ baseUrl: '', token: '' });
  await assert.rejects(client.get('key'), /not configured/);
});

test('writes cache values with HTTP PUT and reads them back with HTTP GET', async () => {
  const calls = [];
  let storedValue = null;
  const client = new SharedCacheClient({
    baseUrl: 'http://localhost:8080',
    token: 'b'.repeat(40),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers });
      if (options.method === 'PUT') {
        storedValue = JSON.parse(options.body);
        return new Response(JSON.stringify({ status: 'ok', key: storedValue.key, ttlSeconds: storedValue.ttlSeconds }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ hit: Boolean(storedValue), value: storedValue?.value ?? null }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.equal(await client.set('verification:key', { ok: true }, 60), true);
  assert.deepEqual(await client.get('verification:key'), { ok: true });
  assert.deepEqual(calls.map(call => call.method), ['PUT', 'GET']);
  assert.ok(calls.every(call => call.headers['x-cache-service-token'] === 'b'.repeat(40)));
});

import { LruKCache, SingleFlight, TieredCache } from './index.js';

test('LRU-K evicts the entry with the oldest kth reference and expires stale values', () => {
  let now = 1000;
  const cache = new LruKCache({ capacity: 2, k: 2, now: () => now });
  cache.set('a', 'A', 100);
  assert.equal(cache.get('a'), 'A');
  cache.set('b', 'B', 100);
  assert.equal(cache.get('b'), 'B');
  cache.set('c', 'C', 100);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 'B');
  now = 1200;
  assert.equal(cache.get('b'), undefined);
});

test('single-flight coalesces concurrent loads and clears rejected work', async () => {
  const flight = new SingleFlight();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return 'value';
  };
  const values = await Promise.all([
    flight.run('same', loader),
    flight.run('same', loader),
    flight.run('same', loader)
  ]);
  assert.deepEqual(values, ['value', 'value', 'value']);
  assert.equal(calls, 1);
  await assert.rejects(flight.run('reject', async () => { throw new Error('failure'); }), /failure/);
  assert.equal(flight.size, 0);
});

test('tiered cache coalesces source loads, writes L1/L2 and invalidates both tiers', async () => {
  const remoteValues = new Map();
  const calls = { get: 0, set: 0, del: 0, load: 0 };
  const l2 = {
    enabled: true,
    async get(key) { calls.get += 1; return remoteValues.get(key) ?? null; },
    async set(key, value) { calls.set += 1; remoteValues.set(key, value); },
    async del(key) { calls.del += 1; return remoteValues.delete(key); }
  };
  const cache = new TieredCache({ l1: new LruKCache({ capacity: 10 }), l2, namespace: 'test' });
  const loader = async () => { calls.load += 1; return { version: 1 }; };
  const [one, two] = await Promise.all([
    cache.getOrLoad('catalog', loader),
    cache.getOrLoad('catalog', loader)
  ]);
  assert.deepEqual(one, { version: 1 });
  assert.deepEqual(two, { version: 1 });
  assert.equal(calls.load, 1);
  assert.equal(calls.set, 1);
  assert.deepEqual(await cache.getOrLoad('catalog', loader), { version: 1 });
  assert.equal(calls.get, 1);
  await cache.invalidate('catalog');
  assert.equal(calls.del, 1);
  assert.deepEqual(await cache.getOrLoad('catalog', loader), { version: 1 });
  assert.equal(calls.load, 2);
});
