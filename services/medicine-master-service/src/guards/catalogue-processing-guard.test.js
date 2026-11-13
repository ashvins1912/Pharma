import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCatalogueProcessingGuard } from './catalogue-processing-guard.js';

test('processing guard allows work below configured thresholds', () => {
  assert.deepEqual(evaluateCatalogueProcessingGuard({
    enabled: true, heapUsedPercent: 40, cpuLoadPercent: 30, queuedJobs: 0
  }), { allowed: true, reasons: [] });
});

test('processing guard pauses when heap pressure is high', () => {
  const result = evaluateCatalogueProcessingGuard({
    enabled: true, heapUsedPercent: 95, cpuLoadPercent: 10, queuedJobs: 0
  });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('HEAP_PRESSURE'));
});

test('processing guard pauses when CPU pressure is high', () => {
  const result = evaluateCatalogueProcessingGuard({
    enabled: true, heapUsedPercent: 20, cpuLoadPercent: 99, queuedJobs: 0
  });
  assert.ok(result.reasons.includes('CPU_PRESSURE'));
});

test('processing guard rejects work when queue capacity is reached', () => {
  const result = evaluateCatalogueProcessingGuard({
    enabled: true, heapUsedPercent: 20, cpuLoadPercent: 10, queuedJobs: 10
  });
  assert.ok(result.reasons.includes('QUEUE_CAPACITY_REACHED'));
});

test('processing guard supports an operator pause', () => {
  const result = evaluateCatalogueProcessingGuard({
    enabled: false, heapUsedPercent: 10, cpuLoadPercent: 10, queuedJobs: 0
  });
  assert.deepEqual(result.reasons, ['PROCESSING_DISABLED']);
});
