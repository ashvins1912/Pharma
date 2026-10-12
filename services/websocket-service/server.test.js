import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('standalone websocket service exposes health and readiness endpoints', async t => {
  const port = 18000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), CORS_ALLOWED_ORIGINS: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  t.after(() => {
    if (!child.killed) child.kill('SIGTERM');
  });

  let healthResponse;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  assert.ok(healthResponse, `service did not start. Output: ${output}`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.status, 'healthy');
  assert.equal(health.service, 'websocket-service');
  assert.equal(typeof health.activeConnections, 'number');
  assert.equal(typeof health.heartbeatIntervalMs, 'number');

  const readyResponse = await fetch(`http://127.0.0.1:${port}/ready`);
  assert.equal(readyResponse.status, 200);
  assert.equal((await readyResponse.json()).status, 'ready');

  const missingResponse = await fetch(`http://127.0.0.1:${port}/not-a-route`);
  assert.equal(missingResponse.status, 404);
});
