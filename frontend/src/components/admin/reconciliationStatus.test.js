import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRetryDelayMs, parseRetryAfterMs } from '../../api/apiClient.js';
import {
  createActionIdempotencyKey,
  getEffectiveBatchState,
  getPipelineStageIndex,
  getReconciliationStatusMeta,
  isBatchReviewable,
  isBatchSelectableForMergeOrDelete,
  pollImportJobWithBackoff
} from './reconciliationStatus.js';

test('frontend Retry-After and exponential backoff helper computes safe jittered delays', () => {
  assert.equal(parseRetryAfterMs('3'), 3000);
  assert.equal(parseRetryAfterMs(''), 0);
  assert.equal(computeRetryDelayMs({ attempt: 0, baseDelayMs: 400, maxDelayMs: 8000, random: () => 1 }), 400);
  assert.equal(computeRetryDelayMs({ attempt: 2, baseDelayMs: 400, maxDelayMs: 8000, retryAfterHeader: '2', random: () => 0.1 }), 2000);
});

test('reconciliationStatus maps canonical and legacy READY states consistently', () => {
  assert.equal(getEffectiveBatchState({ status: 'READY', report: { blockingConflicts: 1 } }), 'CONFLICTS_FOUND');
  assert.equal(getEffectiveBatchState({ status: 'READY', report: { blockingConflicts: 0 } }), 'AWAITING_APPROVAL');
  assert.equal(getEffectiveBatchState({ status: 'READY', approvedAt: '2026-01-01T00:00:00Z' }), 'APPROVED');
  assert.equal(getEffectiveBatchState({ status: 'FAILED', canonicalStatus: 'FAILED' }), 'FAILED');

  assert.equal(isBatchSelectableForMergeOrDelete({ status: 'STAGED', approvedAt: null }), true);
  assert.equal(isBatchSelectableForMergeOrDelete({ status: 'APPROVED', approvedAt: '2026-01-01T00:00:00Z' }), false);
  assert.equal(isBatchReviewable({ status: 'CONFLICTS_FOUND' }), true);
  assert.equal(isBatchReviewable({ status: 'FAILED' }), true);

  assert.equal(getPipelineStageIndex('STAGED'), 0);
  assert.equal(getPipelineStageIndex('CONFLICTS_FOUND'), 2);
  assert.equal(getPipelineStageIndex('PUBLISHED'), 6);
  assert.equal(getReconciliationStatusMeta('FAILED').label, 'Failed');
  assert.ok(createActionIdempotencyKey('reconcile', 'batch-1', 3).startsWith('reconcile-batch-1-3'));
});

test('pollImportJobWithBackoff backs off cleanly on 429 and aborts via AbortController', async () => {
  let polls = 0;
  const controller = new AbortController();
  const job = await pollImportJobWithBackoff({
    jobId: 'job-1',
    signal: controller.signal,
    baseDelayMs: 5,
    maxDelayMs: 25,
    random: () => 0,
    fetchJob: async () => {
      polls += 1;
      if (polls === 1) {
        const rateLimited = new Error('Too many requests');
        rateLimited.response = { status: 429, headers: { 'retry-after': '0' } };
        throw rateLimited;
      }
      if (polls === 2) return { jobId: 'job-1', status: 'PROCESSING', progressPercent: 50 };
      return { jobId: 'job-1', status: 'READY', batchId: 'batch-1' };
    }
  });
  assert.equal(polls, 3);
  assert.equal(job.status, 'READY');

  const abortedController = new AbortController();
  abortedController.abort();
  await assert.rejects(
    () => pollImportJobWithBackoff({
      jobId: 'job-2',
      signal: abortedController.signal,
      baseDelayMs: 10,
      fetchJob: async () => ({ status: 'PROCESSING' })
    }),
    err => err.name === 'AbortError'
  );
});
