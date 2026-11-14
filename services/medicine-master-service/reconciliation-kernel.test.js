import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SERVICE_AUTH_SECRET = 'test-service-secret-with-more-than-thirty-two-characters';

const {
  RECONCILIATION_STATES,
  RESOLUTION_ACTIONS,
  TransitionConflictError,
  OptimisticLockError,
  QueueSaturatedError,
  isTransitionAllowed,
  normalizeCanonicalState,
  getAllowedActions,
  parseRetryAfterMs,
  computeBackoffDelayMs,
  withExponentialBackoff,
  reconcileWithExponentialBackoff,
  executeReconcileServiceCall,
  transitionBatchState,
  createReconciliationTaskQueue,
  buildStructuredConflicts,
  validateResolutionEntries
} = await import('./src/reconciliation-kernel.js');

const { reconcileCatalogueRecordsAgainstMaster } = await import('./src/medicine-catalogue-import-routes.js');

test('validates the full canonical reconciliation state transition diagram', () => {
  const canonicalEdges = [
    ['STAGING', 'STAGED'],
    ['STAGED', 'RECONCILING'],
    ['RECONCILING', 'CONFLICTS_FOUND'],
    ['RECONCILING', 'RECONCILED'],
    ['CONFLICTS_FOUND', 'RESOLVING'],
    ['RESOLVING', 'RECONCILING'],
    ['RECONCILED', 'AWAITING_APPROVAL'],
    ['AWAITING_APPROVAL', 'APPROVED'],
    ['APPROVED', 'PUBLISHING'],
    ['PUBLISHING', 'PUBLISHED'],
    ['PUBLISHING', 'FAILED'],
    ['FAILED', 'RECONCILING']
  ];
  for (const [from, to] of canonicalEdges) {
    assert.equal(isTransitionAllowed(from, to), true, `Expected ${from} -> ${to} to be allowed`);
  }

  assert.equal(isTransitionAllowed('STAGED', 'PUBLISHED'), false);
  assert.equal(isTransitionAllowed('CONFLICTS_FOUND', 'APPROVED'), false);
  assert.equal(isTransitionAllowed('PUBLISHED', 'RECONCILING'), false);
  assert.equal(isTransitionAllowed('AWAITING_APPROVAL', 'PUBLISHED'), false);
});

test('normalizes legacy READY batches into canonical states and allowed actions', () => {
  assert.equal(normalizeCanonicalState({ status: 'READY', approvedAt: null, report: { blockingConflicts: 2 } }), 'CONFLICTS_FOUND');
  assert.equal(normalizeCanonicalState({ status: 'READY', approvedAt: null, report: { blockingConflicts: 0 }, conflicts: [] }), 'AWAITING_APPROVAL');
  assert.equal(normalizeCanonicalState({ status: 'READY', approvedAt: new Date() }), 'APPROVED');
  assert.deepEqual(getAllowedActions({ status: 'FAILED' }), ['RECONCILE', 'RESOLVE_CONFLICTS']);
  assert.deepEqual(getAllowedActions({ status: 'AWAITING_APPROVAL' }), ['RECONCILE', 'APPROVE']);
  assert.deepEqual(getAllowedActions({ status: 'APPROVED' }), ['RECONCILE', 'PUBLISH']);
});

test('transitionBatchState enforces atomic Compare-And-Swap, expired lease takeover, and state history', async () => {
  let doc = {
    batchId: 'batch-cas-1',
    status: RECONCILIATION_STATES.STAGED,
    stateVersion: 0,
    leaseExpiresAt: null,
    stateHistory: [],
    isHidden: false
  };

  const FakeModel = {
    async findOneAndUpdate(filter, update) {
      if (filter.batchId !== doc.batchId) return null;
      if (filter.stateVersion !== undefined && filter.stateVersion !== doc.stateVersion) return null;
      const matchesStatus = (clause) => {
        if (clause.status?.$in) {
          if (!clause.status.$in.includes(doc.status)) return false;
        }
        if (clause.$or) {
          const leaseExpired = !doc.leaseExpiresAt || new Date(doc.leaseExpiresAt) <= new Date();
          if (!leaseExpired && !clause.$or.some(sub => sub.status?.$in?.includes(doc.status))) return false;
          if (clause.$or.length === 2 && !clause.$or.some(sub => sub.status?.$in?.includes(doc.status))) return false;
        }
        return true;
      };
      if (filter.status?.$in && !filter.status.$in.includes(doc.status)) return null;
      if (filter.$or) {
        const directMatch = filter.$or[0]?.status?.$in?.includes(doc.status);
        const expiredLeaseMatch = filter.$or[1]?.status?.$in?.includes(doc.status)
          && (!doc.leaseExpiresAt || new Date(doc.leaseExpiresAt) <= new Date());
        if (!directMatch && !expiredLeaseMatch) return null;
      }
      doc = {
        ...doc,
        ...(update.$set || {}),
        stateVersion: doc.stateVersion + (update.$inc?.stateVersion || 0),
        stateHistory: [...doc.stateHistory, ...(update.$push?.stateHistory?.$each || [])]
      };
      return { ...doc };
    },
    findOne() {
      return {
        lean: async () => ({ ...doc })
      };
    }
  };

  const reconciling = await transitionBatchState(FakeModel, {
    batchId: 'batch-cas-1',
    fromStates: [RECONCILIATION_STATES.STAGED],
    expectedVersion: 0,
    toState: RECONCILIATION_STATES.RECONCILING,
    actorId: 'admin-1',
    reason: 'Start reconcile'
  });
  assert.equal(reconciling.status, RECONCILIATION_STATES.RECONCILING);
  assert.equal(reconciling.stateVersion, 1);
  assert.ok(reconciling.leaseExpiresAt instanceof Date);
  assert.equal(reconciling.stateHistory.length, 1);

  // Stale expectedVersion triggers OptimisticLockError when status matches.
  await assert.rejects(
    () => transitionBatchState(FakeModel, {
      batchId: 'batch-cas-1',
      fromStates: [RECONCILIATION_STATES.RECONCILING],
      expectedVersion: 0,
      toState: RECONCILIATION_STATES.RECONCILED
    }),
    OptimisticLockError
  );

  // Active worker lease blocks competing takeover.
  await assert.rejects(
    () => transitionBatchState(FakeModel, {
      batchId: 'batch-cas-1',
      fromStates: [RECONCILIATION_STATES.STAGED, RECONCILIATION_STATES.FAILED],
      allowExpiredLeaseFrom: [RECONCILIATION_STATES.RECONCILING],
      toState: RECONCILIATION_STATES.RECONCILING
    }),
    err => err instanceof TransitionConflictError && err.code === 'BATCH_BUSY_IN_STATE'
  );

  // Expired worker lease allows recovery takeover cleanly.
  doc.leaseExpiresAt = new Date(Date.now() - 1000);
  const recovered = await transitionBatchState(FakeModel, {
    batchId: 'batch-cas-1',
    fromStates: [RECONCILIATION_STATES.STAGED, RECONCILIATION_STATES.FAILED],
    allowExpiredLeaseFrom: [RECONCILIATION_STATES.RECONCILING],
    toState: RECONCILIATION_STATES.RECONCILING,
    reason: 'Expired lease recovery'
  });
  assert.equal(recovered.status, RECONCILIATION_STATES.RECONCILING);
  assert.equal(recovered.stateVersion, 2);
});

test('ReconciliationTaskQueue serializes per-batch transitions, coalesces duplicates, bounds concurrency, and emits 429 on saturation', async () => {
  const queue = createReconciliationTaskQueue({
    maxConcurrent: 2,
    maxQueueSize: 3,
    useResourceGuard: false
  });

  // 1. Per-batch serial ordering without overlap
  const timeline = [];
  const laneResults = await Promise.all([
    queue.enqueue({
      batchId: 'batch-lane-a',
      operation: 'step1',
      task: async () => {
        timeline.push('a1-start');
        await new Promise(r => setTimeout(r, 25));
        timeline.push('a1-end');
        return 1;
      }
    }),
    queue.enqueue({
      batchId: 'batch-lane-a',
      operation: 'step2',
      task: async () => {
        timeline.push('a2-start');
        await new Promise(r => setTimeout(r, 10));
        timeline.push('a2-end');
        return 2;
      }
    })
  ]);
  assert.deepEqual(laneResults, [1, 2]);
  assert.deepEqual(timeline, ['a1-start', 'a1-end', 'a2-start', 'a2-end']);

  // 2. Coalescing identical concurrent triggers eliminates thundering-herd 429s
  let workerCalls = 0;
  const coalescedCalls = await Promise.all(
    Array.from({ length: 5 }, () => queue.enqueue({
      batchId: 'batch-coalesce',
      operation: 'reconcile',
      coalesceKey: 'same-key',
      task: async () => {
        workerCalls += 1;
        await new Promise(r => setTimeout(r, 20));
        return { ok: true, calls: workerCalls };
      }
    }))
  );
  assert.equal(workerCalls, 1);
  assert.equal(coalescedCalls.every(item => item.calls === 1), true);

  // 3. Global concurrency bound + bounded queue returns 429 QueueSaturatedError with Retry-After
  let activePeak = 0;
  let currentActive = 0;
  const blockers = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id, idx) =>
    queue.enqueue({
      batchId: `sat-${id}`,
      operation: `op-${idx}`,
      task: async () => {
        currentActive += 1;
        activePeak = Math.max(activePeak, currentActive);
        await new Promise(r => setTimeout(r, 35));
        currentActive -= 1;
        return id;
      }
    }).catch(err => err)
  );
  const outcomes = await Promise.all(blockers);
  assert.ok(activePeak <= 2);
  const saturatedErrors = outcomes.filter(item => item instanceof QueueSaturatedError);
  assert.ok(saturatedErrors.length >= 1);
  assert.equal(saturatedErrors[0].statusCode, 429);
  assert.ok(saturatedErrors[0].retryAfterSec >= 1);
});

test('withExponentialBackoff honors Retry-After headers, jitter, and transient lock conflicts', async () => {
  const delays = [];
  let attempts = 0;
  const result = await withExponentialBackoff(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new OptimisticLockError('Simulated CAS contention');
      if (attempts === 2) throw Object.assign(new Error('Rate limited'), { statusCode: 429, retryAfterSec: 1 });
      return 'recovered';
    },
    {
      maxAttempts: 4,
      baseDelayMs: 20,
      maxDelayMs: 500,
      sleep: async ms => { delays.push(ms); },
      random: () => 0.5
    }
  );
  assert.equal(result, 'recovered');
  assert.equal(attempts, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays[1] >= 1000);
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.ok(computeBackoffDelayMs({ attempt: 1, baseDelayMs: 100, maxDelayMs: 1000, retryAfterMs: 300, random: () => 0.1 }) >= 300);
});

test('conflict validation and chunked reconciliation resolve blockers cleanly without false 120-prefix truncation', async () => {
  assert.throws(() => validateResolutionEntries([]), /at least one/i);
  assert.throws(() => validateResolutionEntries([{ medicineId: 'M1', action: 'ACCEPT_CANDIDATE' }]), /targetMedicineId/);

  const valid = validateResolutionEntries([
    { medicineId: 'M-CONFLICT', action: RESOLUTION_ACTIONS.KEEP_SEPARATE },
    { medicineId: 'M-SKIP', action: RESOLUTION_ACTIONS.SKIP_RECORD },
    { medicineId: 'M-MERGE', action: RESOLUTION_ACTIONS.ACCEPT_CANDIDATE, targetMedicineId: 'MASTER-99' }
  ]);
  assert.equal(valid.length, 3);

  const structured = buildStructuredConflicts([
    { medicineId: 'M-CONFLICT', brandName: 'Alpha 10mg', reason: 'MANUAL_REVIEW' }
  ], valid);
  assert.equal(structured[0].resolved, true);

  // Build 150 distinct 2-character brand prefixes (would previously truncate at 120!)
  const incomingRecords = [];
  const masterRows = [];
  for (let i = 0; i < 150; i += 1) {
    const first = String.fromCharCode(65 + (i % 26));
    const second = String.fromCharCode(65 + Math.floor(i / 26));
    const brandName = `${first}${second}Med-${i} 10mg Tablet`;
    incomingRecords.push({
      medicineId: `INC-${i}`,
      brandName,
      canonicalKey: `${first.toLowerCase()}${second.toLowerCase()}med${i}|comp|10mg|tablet`,
      composition: `Ing-${i}`,
      strength: '10 mg',
      dosageForm: 'Tablet',
      reconciliationMatch: null
    });
    masterRows.push({
      medicineId: `INC-${i}`,
      brandName,
      canonicalKey: `${first.toLowerCase()}${second.toLowerCase()}med${i}|comp|10mg|tablet`,
      composition: `Ing-${i}`,
      strength: '10 mg',
      dosageForm: 'Tablet',
      isArchived: false
    });
  }

  // Add 3 conflicted records resolved via SKIP_RECORD, KEEP_SEPARATE, ACCEPT_CANDIDATE
  incomingRecords.push(
    {
      medicineId: 'M-SKIP',
      brandName: 'Zebra 5mg Tablet',
      composition: '',
      strength: '5 mg',
      dosageForm: 'Tablet',
      reconciliationMatch: { decision: 'MANUAL_REVIEW', targetMedicineId: 'MASTER-99', score: 80, warnings: ['COMPOSITION_MISSING_REVIEW_REQUIRED'] }
    },
    {
      medicineId: 'M-CONFLICT',
      brandName: 'Beta 20mg Tablet',
      composition: 'Beta',
      strength: '20 mg',
      dosageForm: 'Tablet',
      reconciliationMatch: { decision: 'BLOCKED_CONFLICT', targetMedicineId: 'MASTER-99', score: 75, warnings: ['COMPOSITION_CONFLICT'] }
    },
    {
      medicineId: 'M-MERGE',
      brandName: 'Gamma 50mg Tablet',
      composition: 'Gamma',
      strength: '50 mg',
      dosageForm: 'Tablet',
      reconciliationMatch: { decision: 'MANUAL_REVIEW', targetMedicineId: 'MASTER-99', score: 88 }
    }
  );
  masterRows.push({
    medicineId: 'MASTER-99',
    brandName: 'Gamma 50mg Tablet',
    composition: 'Gamma',
    strength: '50 mg',
    dosageForm: 'Tablet',
    isArchived: false
  });

  const MockMasterModel = {
    find(query) {
      const match = (row) => {
        if (query.isArchived === true && row.isArchived !== true) return false;
        if (query.isArchived?.$ne === true && row.isArchived === true) return false;
        if (query.medicineId?.$in && !query.medicineId.$in.includes(row.medicineId)) return false;
        if (query.canonicalKey?.$in && !query.canonicalKey.$in.includes(row.canonicalKey)) return false;
        if (query.brandName?.$in && !query.brandName.$in.includes(row.brandName)) return false;
        if (query.$or) {
          return query.$or.some(clause => {
            if (!clause.brandName?.$regex) return false;
            const regex = new RegExp(clause.brandName.$regex, clause.brandName.$options || '');
            return regex.test(row.brandName);
          });
        }
        return true;
      };
      const rows = masterRows.filter(match);
      return {
        limit(n) {
          return { lean: async () => rows.slice(0, n) };
        },
        lean: async () => rows
      };
    }
  };

  const recon = await reconcileCatalogueRecordsAgainstMaster(incomingRecords, {
    conflictResolutions: valid,
    masterModel: MockMasterModel
  });

  assert.equal(recon.scanTruncated, false, 'Expected >120 prefix reconciliation to complete without truncation');
  assert.equal(recon.blockers.length, 0);
  assert.equal(recon.summary.skippedRecords, 1);
  assert.equal(recon.summary.newInserts, 1);
  assert.equal(recon.summary.matchedUpdates, 151);
});

test('reconcileWithExponentialBackoff retries 429 Response objects and thrown 429/Mongo rate-limit errors with Retry-After, and aborts cleanly', async () => {
  assert.equal(executeReconcileServiceCall, reconcileWithExponentialBackoff);

  // 1. Retries returned 429 Response objects using Retry-After header and thrown Mongo 16500 / 429 errors
  const retryEvents = [];
  const recordedDelays = [];
  let calls = 0;
  const response = await reconcileWithExponentialBackoff(
    async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          headers: new Headers({ 'retry-after': '1' })
        };
      }
      if (calls === 2) {
        throw Object.assign(new Error('RequestRateTooLarge'), { code: 16500 });
      }
      return { status: 200, ok: true, batchId: 'batch-ok' };
    },
    {
      maxAttempts: 5,
      baseDelayMs: 25,
      maxDelayMs: 500,
      sleep: async ms => { recordedDelays.push(ms); },
      random: () => 0.5,
      onRetry: event => retryEvents.push(event)
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.batchId, 'batch-ok');
  assert.equal(calls, 3);
  assert.equal(retryEvents.length, 2);
  assert.equal(retryEvents[0].status, 429);
  assert.equal(retryEvents[0].retryAfterMs, 1000);
  assert.ok(recordedDelays[0] >= 1000);

  // 2. Does not retry non-retryable 400 validation errors
  let nonRetryableCalls = 0;
  await assert.rejects(
    () => reconcileWithExponentialBackoff(
      async () => {
        nonRetryableCalls += 1;
        throw Object.assign(new Error('Invalid batch schema'), { statusCode: 400 });
      },
      { maxAttempts: 4, sleep: async () => {} }
    ),
    err => err.statusCode === 400
  );
  assert.equal(nonRetryableCalls, 1);

  // 3. Respects AbortSignal during backoff wait
  const controller = new AbortController();
  let abortedCalls = 0;
  const abortPromise = reconcileWithExponentialBackoff(
    async () => {
      abortedCalls += 1;
      return { status: 429, headers: { 'Retry-After': '5' } };
    },
    {
      maxAttempts: 4,
      baseDelayMs: 500,
      signal: controller.signal
    }
  );
  setTimeout(() => controller.abort(new Error('User cancelled reconcile')), 15);
  await assert.rejects(abortPromise, /User cancelled reconcile/);
  assert.equal(abortedCalls, 1);
});

test('queue.reconcile prevents 429 Too Many Requests bursts via exponential backoff retry', async () => {
  const queue = createReconciliationTaskQueue({
    maxConcurrent: 1,
    maxQueueSize: 1,
    useResourceGuard: false
  });

  // Fill the single active slot + single waiting slot, then launch additional reconcile calls.
  // Without queue.reconcile backoff, the 3rd+ call would immediately fail with 429 QueueSaturatedError.
  const results = await Promise.all([
    queue.reconcile({
      batchId: 'reconcile-burst-1',
      task: async () => {
        await new Promise(r => setTimeout(r, 25));
        return 'b1';
      }
    }),
    queue.reconcile({
      batchId: 'reconcile-burst-2',
      task: async () => {
        await new Promise(r => setTimeout(r, 25));
        return 'b2';
      }
    }),
    queue.reconcile({
      batchId: 'reconcile-burst-3',
      task: async () => {
        await new Promise(r => setTimeout(r, 20));
        return 'b3';
      }
    }),
    queue.reconcile({
      batchId: 'reconcile-burst-4',
      task: async () => 'b4'
    })
  ]);

  assert.deepEqual(results, ['b1', 'b2', 'b3', 'b4']);
  const metrics = queue.getMetrics();
  assert.equal(metrics.reconcileCalls, 4);
  assert.ok(metrics.reconcileRateLimitPrevented >= 1);
  assert.ok(metrics.reconcileRetries >= 1);
});
