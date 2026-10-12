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
