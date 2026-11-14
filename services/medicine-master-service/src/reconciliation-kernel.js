import { createHash } from 'node:crypto';
import {
  catalogueProcessingLimits,
  evaluateCatalogueProcessingGuard,
  getCatalogueProcessingResourceSnapshot
} from './guards/catalogue-processing-guard.js';

export const RECONCILIATION_STATES = Object.freeze({
  STAGING: 'STAGING',
  STAGED: 'STAGED',
  RECONCILING: 'RECONCILING',
  CONFLICTS_FOUND: 'CONFLICTS_FOUND',
  RESOLVING: 'RESOLVING',
  RECONCILED: 'RECONCILED',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  PARTIALLY_PUBLISHED: 'PARTIALLY_PUBLISHED',
  FAILED: 'FAILED',
  SUPERSEDED: 'SUPERSEDED',
  // Legacy status preserved for pre-existing staged Mongo documents.
  READY: 'READY'
});

export const WORKER_LEASE_STATES = new Set([
  RECONCILIATION_STATES.RECONCILING,
  RECONCILIATION_STATES.RESOLVING,
  RECONCILIATION_STATES.PUBLISHING
]);

export const PRE_APPROVAL_EDITABLE_STATES = new Set([
  RECONCILIATION_STATES.STAGED,
  RECONCILIATION_STATES.CONFLICTS_FOUND,
  RECONCILIATION_STATES.RESOLVING,
  RECONCILIATION_STATES.RECONCILED,
  RECONCILIATION_STATES.AWAITING_APPROVAL,
  RECONCILIATION_STATES.READY
]);

export const TRANSITION_MATRIX = Object.freeze({
  [RECONCILIATION_STATES.STAGING]: [
    RECONCILIATION_STATES.STAGED,
    RECONCILIATION_STATES.READY,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.STAGED]: [
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.SUPERSEDED,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.RECONCILING]: [
    RECONCILIATION_STATES.CONFLICTS_FOUND,
    RECONCILIATION_STATES.RECONCILED,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.CONFLICTS_FOUND]: [
    RECONCILIATION_STATES.RESOLVING,
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.SUPERSEDED,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.RESOLVING]: [
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.CONFLICTS_FOUND,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.RECONCILED]: [
    RECONCILIATION_STATES.AWAITING_APPROVAL,
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.AWAITING_APPROVAL]: [
    RECONCILIATION_STATES.APPROVED,
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.RESOLVING,
    RECONCILIATION_STATES.SUPERSEDED,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.APPROVED]: [
    RECONCILIATION_STATES.PUBLISHING,
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.PUBLISHING]: [
    RECONCILIATION_STATES.PUBLISHED,
    RECONCILIATION_STATES.PARTIALLY_PUBLISHED,
    RECONCILIATION_STATES.CONFLICTS_FOUND,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.PARTIALLY_PUBLISHED]: [
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.PUBLISHING,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.FAILED]: [
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.RESOLVING,
    RECONCILIATION_STATES.SUPERSEDED
  ],
  // Legacy READY compatibility: maps cleanly into canonical workflow.
  [RECONCILIATION_STATES.READY]: [
    RECONCILIATION_STATES.RECONCILING,
    RECONCILIATION_STATES.RESOLVING,
    RECONCILIATION_STATES.AWAITING_APPROVAL,
    RECONCILIATION_STATES.APPROVED,
    RECONCILIATION_STATES.PUBLISHING,
    RECONCILIATION_STATES.SUPERSEDED,
    RECONCILIATION_STATES.FAILED
  ],
  [RECONCILIATION_STATES.PUBLISHED]: [],
  [RECONCILIATION_STATES.SUPERSEDED]: []
});

export function isTransitionAllowed(fromState, toState) {
  const allowed = TRANSITION_MATRIX[fromState];
  return Array.isArray(allowed) && allowed.includes(toState);
}

export function normalizeCanonicalState(batch) {
  if (!batch) return null;
  if (batch.status === RECONCILIATION_STATES.READY) {
    if (batch.approvedAt) return RECONCILIATION_STATES.APPROVED;
    if (Number(batch.report?.blockingConflicts || 0) > 0 || (Array.isArray(batch.conflicts) && batch.conflicts.some(item => !item.resolved))) {
      return RECONCILIATION_STATES.CONFLICTS_FOUND;
    }
    return RECONCILIATION_STATES.AWAITING_APPROVAL;
  }
  return batch.status;
}

export function getAllowedActions(batch) {
  const canonical = normalizeCanonicalState(batch);
  if (!canonical) return [];
  const actions = [];
  if ([
    RECONCILIATION_STATES.STAGED,
    RECONCILIATION_STATES.CONFLICTS_FOUND,
    RECONCILIATION_STATES.RESOLVING,
    RECONCILIATION_STATES.RECONCILED,
    RECONCILIATION_STATES.AWAITING_APPROVAL,
    RECONCILIATION_STATES.APPROVED,
    RECONCILIATION_STATES.FAILED,
    RECONCILIATION_STATES.PARTIALLY_PUBLISHED
  ].includes(canonical)) {
    actions.push('RECONCILE');
  }
  if ([
    RECONCILIATION_STATES.CONFLICTS_FOUND,
    RECONCILIATION_STATES.RESOLVING,
    RECONCILIATION_STATES.FAILED
  ].includes(canonical)) {
    actions.push('RESOLVE_CONFLICTS');
  }
  if ([
    RECONCILIATION_STATES.RECONCILED,
    RECONCILIATION_STATES.AWAITING_APPROVAL
  ].includes(canonical)) {
    actions.push('APPROVE');
  }
  if ([
    RECONCILIATION_STATES.APPROVED,
    RECONCILIATION_STATES.PARTIALLY_PUBLISHED
  ].includes(canonical)) {
    actions.push('PUBLISH');
  }
  return actions;
}

export class TransitionConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TransitionConflictError';
    this.statusCode = 409;
    this.code = details.code || 'INVALID_STATE_TRANSITION';
    this.currentState = details.currentState || '';
    this.targetState = details.targetState || '';
    this.allowedTransitions = details.allowedTransitions || [];
  }
}

export class OptimisticLockError extends Error {
  constructor(message = 'Concurrent modification detected while updating reconciliation state.') {
    super(message);
    this.name = 'OptimisticLockError';
    this.statusCode = 409;
    this.code = 'OPTIMISTIC_LOCK_CONFLICT';
    this.retryable = true;
  }
}

export class QueueSaturatedError extends Error {
  constructor(message, retryAfterSec = 2, code = 'RECONCILIATION_QUEUE_BUSY') {
    super(message);
    this.name = 'QueueSaturatedError';
    this.statusCode = 429;
    this.code = code;
    this.retryAfterSec = Math.max(1, Math.ceil(Number(retryAfterSec) || 2));
    this.retryable = true;
  }
}

export function parseRetryAfterMs(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value * 1000));
  const raw = String(value).trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(0, Math.round(numeric * 1000));
  const parsedDate = Date.parse(raw);
  if (Number.isFinite(parsedDate)) return Math.max(0, parsedDate - Date.now());
  return 0;
}

export function extractRetryAfterMs(target) {
  if (!target) return 0;
  if (typeof target.retryAfterMs === 'number' && Number.isFinite(target.retryAfterMs)) {
    return Math.max(0, target.retryAfterMs);
  }
  if (typeof target.retryAfterSec === 'number' && Number.isFinite(target.retryAfterSec)) {
    return Math.max(0, Math.round(target.retryAfterSec * 1000));
  }
  if (typeof target.retryAfter === 'number' && Number.isFinite(target.retryAfter)) {
    return Math.max(0, Math.round(target.retryAfter * 1000));
  }
  const headerContainers = [
    target.headers,
    target.response?.headers
  ];
  for (const headers of headerContainers) {
    if (!headers) continue;
    const rawHeader = typeof headers.get === 'function'
      ? headers.get('retry-after')
      : (headers['retry-after'] ?? headers['Retry-After']);
    const parsed = parseRetryAfterMs(rawHeader);
    if (parsed > 0) return parsed;
  }
  return 0;
}

export function isRetryableTransitionError(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  const status = Number(error.statusCode || error.status || error.response?.status || 0);
  if (status === 429 || status === 503 || status === 502 || status === 504 || status === 408) return true;
  if (error.code === 112 || error.codeName === 'WriteConflict') return true;
  if (error.code === 16500 || error.code === 429 || error.codeName === 'TooManyRequests' || error.codeName === 'RequestRateTooLarge') return true;
  if (error.code === 'OPTIMISTIC_LOCK_CONFLICT' || error.code === 'RECONCILIATION_QUEUE_BUSY' || error.code === 'RECONCILIATION_RESOURCE_PRESSURE' || error.code === 'RATE_LIMIT_EXCEEDED') return true;
  if (Array.isArray(error.errorLabels) && error.errorLabels.includes('TransientTransactionError')) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.code)) return true;
  return false;
}

export function isRetryableReconcileResponse(response) {
  if (!response || typeof response !== 'object') return false;
  const status = Number(response.status || response.statusCode || 0);
  return status === 429 || status === 503;
}

export function computeBackoffDelayMs({
  attempt = 0,
  baseDelayMs = 120,
  maxDelayMs = 5000,
  retryAfterMs = 0,
  maxRetryAfterMs = 30_000,
  random = Math.random
} = {}) {
  const safeAttempt = Math.max(0, Math.min(10, Number(attempt) || 0));
  const cap = Math.max(baseDelayMs, Math.min(maxDelayMs, baseDelayMs * (2 ** safeAttempt)));
  const jittered = Math.round(Math.max(0, Math.min(1, random())) * cap);
  const boundedRetryAfter = retryAfterMs > 0 ? Math.min(maxRetryAfterMs, retryAfterMs) : 0;
  return Math.max(boundedRetryAfter, Math.max(10, jittered));
}

function waitWithOptionalAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || Object.assign(new Error('Reconcile operation aborted.'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || Object.assign(new Error('Reconcile operation aborted.'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withExponentialBackoff(operation, {
  maxAttempts = 4,
  baseDelayMs = 120,
  maxDelayMs = 4000,
  maxRetryAfterMs = 30_000,
  shouldRetry = isRetryableTransitionError,
  signal = undefined,
  sleep = (ms, abortSignal) => waitWithOptionalAbort(ms, abortSignal),
  random = Math.random,
  onRetry = null
} = {}) {
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason || Object.assign(new Error('Operation aborted.'), { name: 'AbortError' });
    }
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !shouldRetry(error, attempt)) throw error;
      const retryAfterMs = extractRetryAfterMs(error);
      const delayMs = computeBackoffDelayMs({ attempt, baseDelayMs, maxDelayMs, retryAfterMs, maxRetryAfterMs, random });
      if (onRetry) await onRetry({ attempt: attempt + 1, maxAttempts: attempts, delayMs, retryAfterMs, error });
      await sleep(delayMs, signal);
    }
  }
  throw lastError;
}

export const DEFAULT_RECONCILE_BACKOFF_OPTIONS = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
  maxRetryAfterMs: 30_000
});

/**
 * Exponential backoff retry wrapper built specifically for `reconcile` service calls.
 * Handles both thrown 429/transient errors AND returned HTTP Response objects with
 * status 429/503, honoring `Retry-After` headers with full jitter and AbortSignal support.
 */
export async function reconcileWithExponentialBackoff(reconcileCall, options = {}) {
  const {
    maxAttempts = DEFAULT_RECONCILE_BACKOFF_OPTIONS.maxAttempts,
    baseDelayMs = DEFAULT_RECONCILE_BACKOFF_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_RECONCILE_BACKOFF_OPTIONS.maxDelayMs,
    maxRetryAfterMs = DEFAULT_RECONCILE_BACKOFF_OPTIONS.maxRetryAfterMs,
    shouldRetryError = isRetryableTransitionError,
    shouldRetryResponse = isRetryableReconcileResponse,
    signal = undefined,
    sleep = (ms, abortSignal) => waitWithOptionalAbort(ms, abortSignal),
    random = Math.random,
    onRetry = null
  } = options;

  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason || Object.assign(new Error('Reconcile service call aborted.'), { name: 'AbortError' });
    }
    try {
      const response = await reconcileCall({ attempt, signal });
      if (!shouldRetryResponse(response, attempt)) {
        return response;
      }
      lastResponse = response;
      const retryAfterMs = extractRetryAfterMs(response);
      if (attempt >= attempts - 1) {
        return response;
      }
      const delayMs = computeBackoffDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        retryAfterMs,
        maxRetryAfterMs,
        random
      });
      if (onRetry) {
        await onRetry({
          attempt: attempt + 1,
          maxAttempts: attempts,
          delayMs,
          retryAfterMs,
          status: Number(response.status || response.statusCode || 429),
          error: null
        });
      }
      await sleep(delayMs, signal);
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      lastError = error;
      if (attempt >= attempts - 1 || !shouldRetryError(error, attempt)) throw error;
      const retryAfterMs = extractRetryAfterMs(error);
      const delayMs = computeBackoffDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        retryAfterMs,
        maxRetryAfterMs,
        random
      });
      if (onRetry) {
        await onRetry({
          attempt: attempt + 1,
          maxAttempts: attempts,
          delayMs,
          retryAfterMs,
          status: Number(error.statusCode || error.status || error.response?.status || 0),
          error
        });
      }
      await sleep(delayMs, signal);
    }
  }

  if (lastError) throw lastError;
  return lastResponse;
}

export const executeReconcileServiceCall = reconcileWithExponentialBackoff;

/**
 * Atomically transitions a CatalogueImport document using MongoDB Compare-And-Swap
 * on `status` + `stateVersion` (with optional expired-lease takeover for stuck workers).
 */
export async function transitionBatchState(Model, {
  batchId,
  fromStates,
  toState,
  expectedVersion = null,
  actorId = '',
  reason = '',
  correlationId = '',
  set = {},
  unset = {},
  leaseMs = catalogueProcessingLimits.workerLeaseMs || 900_000,
  allowExpiredLeaseFrom = []
}) {
  const normalizedFrom = (Array.isArray(fromStates) ? fromStates : [fromStates]).filter(Boolean);
  for (const state of normalizedFrom) {
    if (!isTransitionAllowed(state, toState)) {
      throw new TransitionConflictError(
        `Invalid state transition from ${state} to ${toState}.`,
        { currentState: state, targetState: toState, allowedTransitions: TRANSITION_MATRIX[state] || [] }
      );
    }
  }

  const now = new Date();
  const leaseFilter = allowExpiredLeaseFrom.length
    ? {
        $or: [
          { status: { $in: normalizedFrom } },
          {
            status: { $in: allowExpiredLeaseFrom },
            $or: [{ leaseExpiresAt: { $lte: now } }, { leaseExpiresAt: null }]
          }
        ]
      }
    : { status: { $in: normalizedFrom } };

  const filter = {
    batchId,
    isHidden: { $ne: true },
    ...leaseFilter,
    ...(expectedVersion !== null && expectedVersion !== undefined ? { stateVersion: expectedVersion } : {})
  };

  const nextLease = WORKER_LEASE_STATES.has(toState) ? new Date(now.getTime() + leaseMs) : null;
  const historyEntry = {
    from: normalizedFrom.length === 1 ? normalizedFrom[0] : normalizedFrom.join('|'),
    to: toState,
    actorId: String(actorId || '').slice(0, 120),
    reason: String(reason || '').slice(0, 240),
    correlationId: String(correlationId || '').slice(0, 128),
    at: now
  };

  const update = {
    $set: {
      ...set,
      status: toState,
      leaseExpiresAt: nextLease
    },
    $inc: { stateVersion: 1 },
    $push: {
      stateHistory: {
        $each: [historyEntry],
        $slice: -100
      }
    },
    ...(Object.keys(unset).length ? { $unset: unset } : {})
  };

  const updated = await Model.findOneAndUpdate(filter, update, { new: true });
  if (updated) return updated;

  const existing = await Model.findOne({ batchId, isHidden: { $ne: true } }, {
    batchId: 1, status: 1, stateVersion: 1, leaseExpiresAt: 1
  }).lean();
  if (!existing) {
    throw Object.assign(new Error('Catalogue import batch was not found.'), { statusCode: 404, code: 'BATCH_NOT_FOUND' });
  }
  if (normalizedFrom.includes(existing.status) && expectedVersion !== null && existing.stateVersion !== expectedVersion) {
    throw new OptimisticLockError('Batch state changed concurrently before transition could complete.');
  }
  if (WORKER_LEASE_STATES.has(existing.status) && existing.leaseExpiresAt && new Date(existing.leaseExpiresAt) > now) {
    throw new TransitionConflictError(
      `Batch is currently busy in state ${existing.status}. Wait for the active worker lease to finish.`,
      { code: 'BATCH_BUSY_IN_STATE', currentState: existing.status, targetState: toState, allowedTransitions: TRANSITION_MATRIX[existing.status] || [] }
    );
  }
  throw new TransitionConflictError(
    `Cannot transition catalogue batch from ${existing.status} to ${toState}.`,
    { currentState: existing.status, targetState: toState, allowedTransitions: TRANSITION_MATRIX[existing.status] || [] }
  );
}

/**
 * Serializes operations per `batchId`, coalesces identical in-flight operations,
 * bounds global concurrent workers, retries transient DB/CAS contention with jittered
 * exponential backoff, and emits HTTP 429 + Retry-After backpressure instead of letting
 * thundering herds overload MongoDB or fail with spurious lock conflicts.
 */
export function createReconciliationTaskQueue({
  maxConcurrent = catalogueProcessingLimits.maxConcurrentJobs || 3,
  maxQueueSize = 60,
  useResourceGuard = true,
  resourceEvaluator = () => {
    const snap = getCatalogueProcessingResourceSnapshot();
    return evaluateCatalogueProcessingGuard({
      heapUsedPercent: snap.process.heapUsedPercent,
      rssUsedPercent: snap.process.rssUsedPercent,
      cpuLoadPercent: snap.host.cpuLoadPercent,
      queuedJobs: 0
    });
  }
} = {}) {
  let activeCount = 0;
  const waitingQueue = [];
  const batchLanes = new Map();
  const coalescedInFlight = new Map();
  const metrics = {
    enqueued: 0,
    completed: 0,
    failed: 0,
    coalesced: 0,
    retried: 0,
    rateLimited: 0,
    reconcileCalls: 0,
    reconcileRetries: 0,
    reconcileRateLimitPrevented: 0
  };

  const pump = () => {
    while (activeCount < maxConcurrent && waitingQueue.length > 0) {
      const nextItem = waitingQueue.shift();
      activeCount += 1;
      Promise.resolve()
        .then(() => nextItem.run())
        .then(nextItem.resolve, nextItem.reject)
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1);
          pump();
        });
    }
  };

  const acquireSlot = (run) => {
    if (useResourceGuard) {
      const guard = resourceEvaluator();
      if (!guard.allowed) {
        metrics.rateLimited += 1;
        return Promise.reject(new QueueSaturatedError(
          `Reconciliation service is temporarily busy (${guard.reasons.join(', ')}). Retry shortly.`,
          3,
          'RECONCILIATION_RESOURCE_PRESSURE'
        ));
      }
    }
    if (waitingQueue.length >= maxQueueSize) {
      metrics.rateLimited += 1;
      const estimatedWaitSec = Math.max(1, Math.min(30, Math.ceil((waitingQueue.length + 1) / Math.max(1, maxConcurrent))));
      return Promise.reject(new QueueSaturatedError(
        'Too many concurrent reconciliation transitions queued. Please wait briefly and retry.',
        estimatedWaitSec,
        'RECONCILIATION_QUEUE_BUSY'
      ));
    }
    metrics.enqueued += 1;
    return new Promise((resolve, reject) => {
      waitingQueue.push({ run, resolve, reject });
      pump();
    });
  };

  const enqueueOnce = ({
    batchId,
    operation = 'reconcile',
    coalesceKey = '',
    backoffOptions = {},
    task
  }) => {
    const dedupeKey = coalesceKey ? `${batchId}:${operation}:${coalesceKey}` : '';
    if (dedupeKey && coalescedInFlight.has(dedupeKey)) {
      metrics.coalesced += 1;
      return coalescedInFlight.get(dedupeKey);
    }

    const previousLane = batchLanes.get(batchId) || Promise.resolve();
    const lanePromise = previousLane.catch(() => {}).then(() =>
      acquireSlot(() =>
        withExponentialBackoff(task, {
          maxAttempts: 4,
          baseDelayMs: 120,
          maxDelayMs: 3000,
          ...backoffOptions,
          onRetry: async info => {
            metrics.retried += 1;
            if (operation === 'reconcile') metrics.reconcileRetries += 1;
            if (backoffOptions.onRetry) await backoffOptions.onRetry(info);
          }
        })
      )
    );

    const tracked = lanePromise.then(
      result => {
        metrics.completed += 1;
        return result;
      },
      error => {
        metrics.failed += 1;
        throw error;
      }
    ).finally(() => {
      if (batchLanes.get(batchId) === lanePromise) batchLanes.delete(batchId);
      if (dedupeKey && coalescedInFlight.get(dedupeKey) === tracked) coalescedInFlight.delete(dedupeKey);
    });

    batchLanes.set(batchId, lanePromise);
    if (dedupeKey) coalescedInFlight.set(dedupeKey, tracked);
    return tracked;
  };

  const enqueue = ({
    retryOnQueueBusy = false,
    queueBackoffOptions = {},
    ...options
  }) => {
    if (!retryOnQueueBusy) {
      return enqueueOnce(options);
    }
    return reconcileWithExponentialBackoff(
      () => enqueueOnce(options),
      {
        maxAttempts: 4,
        baseDelayMs: 200,
        maxDelayMs: 4000,
        ...queueBackoffOptions,
        onRetry: async info => {
          metrics.reconcileRetries += 1;
          if (info.status === 429 || info.error instanceof QueueSaturatedError) {
            metrics.reconcileRateLimitPrevented += 1;
          }
          if (queueBackoffOptions.onRetry) await queueBackoffOptions.onRetry(info);
        }
      }
    );
  };

  /**
   * Dedicated entry point for `reconcile` service calls. Coalesces duplicate keys,
   * serializes per batchId, and applies exponential backoff on 429/queue saturation
   * and transient downstream errors so callers avoid 429 Too Many Requests bursts.
   */
  const reconcile = (options) => {
    metrics.reconcileCalls += 1;
    return enqueue({
      retryOnQueueBusy: true,
      ...options,
      operation: 'reconcile',
      backoffOptions: {
        maxAttempts: 5,
        baseDelayMs: 250,
        maxDelayMs: 8000,
        ...(options?.backoffOptions || {})
      }
    });
  };

  const getMetrics = () => ({
    activeCount,
    queuedCount: waitingQueue.length,
    activeBatchLanes: batchLanes.size,
    inFlightCoalescedKeys: coalescedInFlight.size,
    maxConcurrent,
    maxQueueSize,
    ...metrics
  });

  return { enqueue, reconcile, getMetrics };
}

export const RESOLUTION_ACTIONS = Object.freeze({
  ACCEPT_CANDIDATE: 'ACCEPT_CANDIDATE',
  KEEP_SEPARATE: 'KEEP_SEPARATE',
  SKIP_RECORD: 'SKIP_RECORD'
});

export function buildConflictId(item, index = 0) {
  const seed = [
    String(item?.medicineId || '').trim(),
    String(item?.brandName || '').trim().toLowerCase(),
    String(item?.reason || '').trim(),
    String(index)
  ].join('|');
  return 'CNF-' + createHash('sha256').update(seed).digest('hex').slice(0, 16).toUpperCase();
}

export function buildStructuredConflicts(blockers = [], existingResolutions = []) {
  const resolutionByKey = new Map();
  for (const res of Array.isArray(existingResolutions) ? existingResolutions : []) {
    if (res?.conflictId) resolutionByKey.set(res.conflictId, res);
    if (res?.medicineId) resolutionByKey.set(`MED:${res.medicineId}`, res);
  }
  return blockers.map((blocker, index) => {
    const conflictId = blocker.conflictId || buildConflictId(blocker, index);
    const resolution = resolutionByKey.get(conflictId)
      || (blocker.medicineId ? resolutionByKey.get(`MED:${blocker.medicineId}`) : null)
      || null;
    return {
      conflictId,
      medicineId: blocker.medicineId || '',
      brandName: blocker.brandName || '',
      reason: blocker.reason || 'MANUAL_REVIEW',
      targetMedicineId: blocker.targetMedicineId || '',
      previousTargetMedicineId: blocker.previousTargetMedicineId || '',
      currentTargetMedicineId: blocker.currentTargetMedicineId || '',
      score: Number(blocker.score || 0),
      warnings: Array.isArray(blocker.warnings) ? blocker.warnings : [],
      message: blocker.message || '',
      resolved: Boolean(resolution),
      resolution
    };
  });
}

export function validateResolutionEntries(resolutions = []) {
  if (!Array.isArray(resolutions) || !resolutions.length) {
    throw Object.assign(new Error('Provide at least one conflict resolution decision.'), { statusCode: 400 });
  }
  if (resolutions.length > 1000) {
    throw Object.assign(new Error('You can submit up to 1000 conflict resolutions per request.'), { statusCode: 400 });
  }
  const normalized = [];
  for (const entry of resolutions) {
    const action = String(entry?.action || '').trim().toUpperCase();
    if (!Object.values(RESOLUTION_ACTIONS).includes(action)) {
      throw Object.assign(new Error(`Unsupported conflict resolution action: ${entry?.action || 'empty'}`), { statusCode: 400 });
    }
    const conflictId = String(entry?.conflictId || '').trim().slice(0, 80);
    const medicineId = String(entry?.medicineId || '').trim().slice(0, 120);
    const targetMedicineId = String(entry?.targetMedicineId || '').trim().slice(0, 120);
    if (!conflictId && !medicineId) {
      throw Object.assign(new Error('Each conflict resolution must specify conflictId or medicineId.'), { statusCode: 400 });
    }
    if (action === RESOLUTION_ACTIONS.ACCEPT_CANDIDATE && !targetMedicineId) {
      throw Object.assign(new Error('ACCEPT_CANDIDATE resolution requires a targetMedicineId.'), { statusCode: 400 });
    }
    normalized.push({
      conflictId,
      medicineId,
      action,
      targetMedicineId,
      note: String(entry?.note || '').trim().slice(0, 300)
    });
  }
  return normalized;
}
