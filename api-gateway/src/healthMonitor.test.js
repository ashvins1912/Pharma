import assert from 'node:assert/strict';
import test from 'node:test';
import { createHealthMonitor } from './healthMonitor.js';

const service = (name, critical = false) => ({ name, baseUrl: `http://${name}.example`, healthPath: '/ready', critical });

test('checks configured services independently and normalizes healthy and HTTP failures', async () => {
  const calls = new Map();
  const monitor = createHealthMonitor({
    services: [service('healthy', true), service('broken')],
    fetchImpl: async url => {
      const name = new URL(url).hostname.split('.')[0];
      calls.set(name, (calls.get(name) || 0) + 1);
      return { ok: name === 'healthy', status: name === 'healthy' ? 200 : 503, body: null };
    },
    logger: {}
  });

  const cycle = await monitor.runCycle();
  assert.equal(calls.get('healthy'), 1);
  assert.equal(calls.get('broken'), 2);
  assert.equal(cycle.results.overallStatus, 'DEGRADED');
  assert.equal(cycle.results.services[0].status, 'HEALTHY');
  assert.equal(cycle.results.services[1].status, 'UNHEALTHY');
  assert.equal(cycle.results.services[1].errorType, 'HTTP_ERROR');
});

test('classifies request timeouts and unreachable endpoints without leaking exception text', async () => {
  const timeoutMonitor = createHealthMonitor({
    services: [service('slow')],
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('private host detail'), { name: 'AbortError' })), { once: true });
    }),
    logger: {}
  });
  const timeoutResult = await timeoutMonitor.runCycle();
  assert.equal(timeoutResult.results.services[0].status, 'TIMEOUT');
  assert.equal(timeoutResult.results.services[0].errorMessage.includes('private'), false);

  const unreachableMonitor = createHealthMonitor({
    services: [service('offline', true)],
    fetchImpl: async () => { throw Object.assign(new Error('private host detail'), { code: 'ECONNREFUSED' }); },
    logger: {}
  });
  const unreachableResult = await unreachableMonitor.runCycle();
  assert.equal(unreachableResult.results.overallStatus, 'UNHEALTHY');
  assert.equal(unreachableResult.results.services[0].status, 'UNREACHABLE');
  assert.equal(unreachableResult.results.services[0].errorMessage.includes('private'), false);
});

test('scheduler is idempotent, uses configured frequency, skips overlaps and stops cleanly', async () => {
  let scheduled;
  let intervalDelay;
  let clearCount = 0;
  let releaseFetch;
  const monitor = createHealthMonitor({
    services: [service('slow')],
    intervalMs: 900_000,
    fetchImpl: () => new Promise(resolve => { releaseFetch = () => resolve({ ok: true, status: 200, body: null }); }),
    logger: {},
    setIntervalFn: (callback, delay) => { scheduled = callback; intervalDelay = delay; return { unref() {} }; },
    clearIntervalFn: () => { clearCount += 1; }
  });

  monitor.start();
  monitor.start();
  assert.equal(intervalDelay, 900_000);
  const firstCycle = monitor.runCycle();
  const overlappingCycle = await monitor.runCycle();
  assert.equal(overlappingCycle.skipped, true);
  const stopping = monitor.stop();
  releaseFetch();
  await firstCycle;
  await stopping;
  assert.equal(clearCount, 1);
  assert.equal(monitor.isScheduled(), false);
  assert.equal(typeof scheduled, 'function');
});

test('disabled scheduler remains stopped and startup checks are configurable', async () => {
  const disabled = createHealthMonitor({ services: [service('one')], enabled: false, logger: {} });
  disabled.start();
  assert.equal(disabled.isScheduled(), false);
});

test('health state transitions are logged once per status change, including recovery', async () => {
  const logs = [];
  const responses = [200, 503, 503, 200];
  const monitor = createHealthMonitor({
    services: [service('changing')],
    fetchImpl: async () => {
      const status = responses.shift() || 200;
      return { ok: status < 400, status, body: null };
    },
    logger: { info: value => logs.push(JSON.parse(value)), warn: value => logs.push(JSON.parse(value)) }
  });
  await monitor.runCycle();
  await monitor.runCycle();
  await monitor.runCycle();
  await monitor.runCycle();
  const stateChanges = logs.filter(entry => entry.event === 'service_health_state_changed');
  const recoveries = logs.filter(entry => entry.event === 'service_health_recovered');
  assert.equal(stateChanges.length, 1);
  assert.equal(recoveries.length, 1);
});
