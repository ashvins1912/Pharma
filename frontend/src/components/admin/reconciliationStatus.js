export const CANONICAL_RECONCILIATION_STATES = Object.freeze({
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
  READY: 'READY'
});

export const RECONCILIATION_PIPELINE_STAGES = [
  { key: 'STAGED', label: 'Staged' },
  { key: 'RECONCILING', label: 'Reconciling' },
  { key: 'CONFLICTS_FOUND', label: 'Conflicts / Resolving' },
  { key: 'AWAITING_APPROVAL', label: 'Awaiting Approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'PUBLISHING', label: 'Publishing' },
  { key: 'PUBLISHED', label: 'Published' }
];

export function getEffectiveBatchState(batch) {
  if (!batch) return '';
  if (batch.canonicalStatus) return batch.canonicalStatus;
  if (batch.status === 'READY') {
    if (batch.approvedAt) return 'APPROVED';
    const hasConflicts = Number(batch.report?.blockingConflicts || 0) > 0
      || (Array.isArray(batch.conflicts) && batch.conflicts.some(item => !item?.resolved));
    return hasConflicts ? 'CONFLICTS_FOUND' : 'AWAITING_APPROVAL';
  }
  return batch.status || '';
}

export function isBatchSelectableForMergeOrDelete(batch) {
  if (!batch || batch.isImportJob) return false;
  const state = getEffectiveBatchState(batch);
  const editableStates = ['STAGED', 'CONFLICTS_FOUND', 'RESOLVING', 'RECONCILED', 'AWAITING_APPROVAL', 'READY'];
  return editableStates.includes(state)
    && !batch.approvedAt
    && !batch.supersededByBatchId
    && !(batch.sourceBatchIds?.length);
}

export function isBatchReviewable(batch) {
  if (!batch || batch.isImportJob) return false;
  return [
    'STAGED',
    'RECONCILING',
    'CONFLICTS_FOUND',
    'RESOLVING',
    'RECONCILED',
    'AWAITING_APPROVAL',
    'APPROVED',
    'PUBLISHING',
    'PUBLISHED',
    'PARTIALLY_PUBLISHED',
    'FAILED',
    'READY'
  ].includes(getEffectiveBatchState(batch)) || ['READY', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED'].includes(batch.status);
}

export function getReconciliationStatusMeta(status) {
  const normalized = String(status || '').toUpperCase();
  switch (normalized) {
    case 'PUBLISHED':
    case 'RECONCILED':
      return {
        label: normalized === 'PUBLISHED' ? 'Published' : 'Reconciled',
        pillClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      };
    case 'APPROVED':
      return {
        label: 'Approved',
        pillClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      };
    case 'AWAITING_APPROVAL':
    case 'READY':
      return {
        label: 'Awaiting Approval',
        pillClass: 'bg-blue-50 text-blue-700 border border-blue-200'
      };
    case 'STAGED':
    case 'STAGING':
    case 'QUEUED':
      return {
        label: normalized === 'QUEUED' ? 'Queued' : normalized === 'STAGING' ? 'Staging' : 'Staged',
        pillClass: 'bg-slate-100 text-slate-700 border border-slate-200'
      };
    case 'RECONCILING':
    case 'PUBLISHING':
    case 'PROCESSING':
      return {
        label: normalized === 'RECONCILING' ? 'Reconciling' : normalized === 'PUBLISHING' ? 'Publishing' : 'Processing',
        pillClass: 'bg-blue-50 text-blue-700 border border-blue-200'
      };
    case 'CONFLICTS_FOUND':
    case 'RESOLVING':
    case 'PARTIALLY_PUBLISHED':
      return {
        label: normalized === 'RESOLVING' ? 'Resolving' : normalized === 'PARTIALLY_PUBLISHED' ? 'Partial Publish' : 'Conflicts Found',
        pillClass: 'bg-amber-50 text-amber-800 border border-amber-200'
      };
    case 'FAILED':
      return {
        label: 'Failed',
        pillClass: 'bg-rose-50 text-rose-700 border border-rose-200'
      };
    case 'SUPERSEDED':
      return {
        label: 'Superseded',
        pillClass: 'bg-slate-100 text-slate-600 border border-slate-200'
      };
    default:
      return {
        label: normalized || 'Unknown',
        pillClass: 'bg-slate-100 text-slate-700 border border-slate-200'
      };
  }
}

export function createActionIdempotencyKey(action, batchId, seed = '') {
  const cleanAction = String(action || 'action').replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  const cleanBatch = String(batchId || 'batch').replace(/[^a-z0-9_-]/gi, '').slice(0, 36);
  const cleanSeed = String(seed || Date.now().toString(36)).replace(/[^a-z0-9_-]/gi, '').slice(0, 36);
  return `${cleanAction}-${cleanBatch}-${cleanSeed}`;
}

export function getPipelineStageIndex(state) {
  switch (String(state || '').toUpperCase()) {
    case 'STAGING':
    case 'STAGED':
      return 0;
    case 'RECONCILING':
      return 1;
    case 'CONFLICTS_FOUND':
    case 'RESOLVING':
      return 2;
    case 'RECONCILED':
    case 'AWAITING_APPROVAL':
    case 'READY':
      return 3;
    case 'APPROVED':
      return 4;
    case 'PUBLISHING':
    case 'PARTIALLY_PUBLISHED':
      return 5;
    case 'PUBLISHED':
      return 6;
    default:
      return -1;
  }
}

export function waitWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Operation aborted.'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Operation aborted.'), { name: 'AbortError' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollImportJobWithBackoff({
  jobId,
  signal,
  fetchJob,
  onUpdate,
  baseDelayMs = 1500,
  maxDelayMs = 8000,
  maxAttempts = 240,
  random = Math.random
}) {
  let delayMs = baseDelayMs;
  let lastProgressSignature = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const jitter = Math.round(delayMs * (0.85 + Math.max(0, Math.min(1, random())) * 0.3));
    await waitWithSignal(jitter, signal);

    let job;
    try {
      job = await fetchJob(jobId, signal);
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      if (error?.status === 429 || error?.status === 503 || error?.response?.status === 429) {
        const retryAfter = Number(error.response?.headers?.['retry-after']);
        delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(maxDelayMs * 2, retryAfter * 1000)
          : Math.min(maxDelayMs, Math.round(delayMs * 1.6));
        continue;
      }
      throw error;
    }

    if (onUpdate) onUpdate(job);
    if (job?.status === 'READY' || job?.status === 'FAILED') {
      return job;
    }

    const signature = `${job?.status || ''}:${job?.stage || ''}:${job?.progressPercent || 0}:${job?.processedRecords || 0}`;
    if (signature !== lastProgressSignature) {
      lastProgressSignature = signature;
      delayMs = baseDelayMs;
    } else {
      delayMs = Math.min(maxDelayMs, Math.round(delayMs * 1.35));
    }
  }

  throw new Error('Background import polling timed out. Check Recent enrichment batches to inspect progress.');
}
