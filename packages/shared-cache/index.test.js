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
