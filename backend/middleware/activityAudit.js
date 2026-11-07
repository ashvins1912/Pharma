import ActivityAudit from '../models/ActivityAudit.js';
import { getIsConnected } from '../config/db.js';

const recentActivity = [];
const MAX_MEMORY_ACTIVITY = 500;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_FIELDS = /password|token|secret|authorization|cookie|prescription|medical|otp|mobile|phone|email|address/i;
const NON_MUTATING_POST_PATHS = [
  /^\/api\/(?:v1\/)?delivery\/check-serviceability\/?$/i,
  /^\/api\/(?:v1\/)?integrations\/test-connection\/?$/i
];

function describeResource(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const normalized = parts.filter(part => !/^v\d+$/i.test(part) && !['api', 'admin'].includes(part.toLowerCase()));
  const actions = new Set(['accept', 'reject', 'approve', 'pause', 'activate', 'suspend', 'status', 'invite', 'assign']);
  const resource = [...normalized].reverse().find(part => !/^[a-f0-9]{16,}$/i.test(part) && !actions.has(part.toLowerCase())) || 'record';
  const entityType = resource.replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  const actionPart = normalized.find(part => ['accept', 'reject', 'approve', 'pause', 'activate', 'suspend', 'status', 'invite', 'assign'].includes(part.toLowerCase()));
  return { entityType, actionPart };
}

function makeAuditRecord(req, statusCode) {
  const pathname = String(req.originalUrl || req.path || '').split('?')[0];
  const normalized = pathname.split('/').filter(part => part && !/^v\d+$/i.test(part) && !['api', 'admin'].includes(part.toLowerCase()));
  const { entityType, actionPart } = describeResource(pathname);
  const method = req.method.toUpperCase();
  const decision = String(req.body?.reviewDecision || req.body?.decision || req.body?.orderStatus || req.body?.newStatus || req.body?.status || req.body?.targetStatus || '').toLowerCase();
  const decisionAction = decision.includes('reject') ? 'REJECT'
    : (decision.includes('approv') || decision === 'accepted' || decision === 'accept') ? 'ACCEPT'
      : null;
  const action = actionPart
    ? actionPart.toUpperCase()
    : decisionAction || (method === 'POST' ? 'CREATE'
      : method === 'DELETE' ? 'DELETE'
        : 'UPDATE');
  const actor = req.user || {};
  const context = req.context || {};
  const actorRole = String(context.role || actor.app_metadata?.role || actor.role || '').toUpperCase();
  const platformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(actorRole);
  // Non-platform tenant scope must come from an authenticated membership or
  // trusted identity metadata, never from customer-supplied tenant/body context.
  const tenantId = context.authorizedTenantId
    || context.tenantMembership?.tenantId
    || actor.tenantId
    || actor.app_metadata?.tenantId
    || (platformAdmin ? (context.tenantId || req.get?.('x-tenant-id')) : null)
    || null;
  const branchId = context.tenantMembership?.branchId
    || (context.authorizedTenantId ? context.branchId : null)
    || actor.branchId
    || actor.app_metadata?.branchId
    || (platformAdmin ? (context.branchId || req.get?.('x-branch-id')) : null)
    || null;
  const changedFields = Object.keys(req.body || {}).filter(key => !SENSITIVE_FIELDS.test(key)).slice(0, 30);
  const idParam = Object.entries(req.params || {}).find(([key]) => /id$/i.test(key));
  return {
    tenantId: tenantId ? String(tenantId) : null,
    branchId: branchId ? String(branchId) : null,
    actorId: String(actor.sub || actor.id || actor.userId || 'unknown'),
    actorName: String(actor.user_metadata?.name || actor.user_metadata?.full_name || actor.name || 'User'),
    actorRole: String(actor.app_metadata?.role || actor.role || context.role || 'user'),
    action,
    entityType,
    entityId: idParam ? String(idParam[1]) : (normalized.find(part => /^[a-f0-9]{16,}$/i.test(part)) || null),
    method,
    path: pathname.slice(0, 240),
    statusCode,
    changedFields,
    requestId: context.requestId || req.requestId || null
  };
}

export function recordActivity(record) {
  recentActivity.unshift({ ...record, _id: record._id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date() });
  if (recentActivity.length > MAX_MEMORY_ACTIVITY) recentActivity.length = MAX_MEMORY_ACTIVITY;
}

export function auditMutation(req, res, next) {
  const method = String(req.method).toUpperCase();
  if (!MUTATING_METHODS.has(method)) return next();
  const requestPath = String(req.originalUrl || req.path || '').split('?')[0];
  // Exclude successful POST probes that do not mutate domain state.
  if (method === 'POST' && NON_MUTATING_POST_PATHS.some(pattern => pattern.test(requestPath))) return next();
  // Do not persist authentication payloads or high-entropy public onboarding tokens in audit paths.
  if (/^\/api\/v1\/auth\//i.test(requestPath) || /^\/api\/(?:v1\/)?vendor\/onboarding\//i.test(requestPath)) return next();
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const record = makeAuditRecord(req, res.statusCode);
    if (getIsConnected()) {
      ActivityAudit.create(record).catch(error => {
        console.error('Could not persist activity audit record:', error.message);
        recordActivity(record);
      });
    } else {
      recordActivity(record);
    }
  });
  next();
}

export async function queryActivity({ tenantId, branchId, page = 1, limit = 20 } = {}) {
  const safePage = Math.min(100, Math.max(1, Number.parseInt(page, 10) || 1));
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
  const filter = {};
  if (tenantId) filter.tenantId = String(tenantId);
  if (branchId) filter.$or = [{ branchId: String(branchId) }, { branchId: null }];
  if (getIsConnected()) {
    const buffered = recentActivity.filter(item =>
      (!tenantId || item.tenantId === String(tenantId))
      && (!branchId || !item.branchId || item.branchId === String(branchId))
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // A write may have failed while MongoDB was unavailable and been buffered in memory.
    // If the write actually reached MongoDB before the connection error, de-duplicate it by requestId.
    const requestIds = buffered.map(item => item.requestId).filter(Boolean);
    const persisted = requestIds.length
      ? await ActivityAudit.find({ ...filter, requestId: { $in: requestIds } }).select('requestId').lean()
      : [];
    const persistedIds = new Set(persisted.map(item => item.requestId));
    const pending = buffered.filter(item => !item.requestId || !persistedIds.has(item.requestId));

    const start = (safePage - 1) * safeLimit;
    const [databaseItems, databaseTotal] = await Promise.all([
      ActivityAudit.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(Math.min(10_500, start + safeLimit + MAX_MEMORY_ACTIVITY))
        .lean(),
      ActivityAudit.countDocuments(filter)
    ]);
    const merged = [...pending, ...databaseItems].sort((a, b) => {
      const timeDifference = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return timeDifference || String(b._id || '').localeCompare(String(a._id || ''));
    });
    const total = databaseTotal + pending.length;
    const items = merged.slice(start, start + safeLimit);
    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
        hasNextPage: start + items.length < total,
        hasPreviousPage: safePage > 1
      }
    };
  }
  const filtered = recentActivity.filter(item => (!tenantId || item.tenantId === String(tenantId)) && (!branchId || !item.branchId || item.branchId === String(branchId)));
  const total = filtered.length;
  return { items: filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit), pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit), hasNextPage: safePage * safeLimit < total, hasPreviousPage: safePage > 1 } };
}
