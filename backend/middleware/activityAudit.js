import ActivityAudit from '../models/ActivityAudit.js';
import { getIsConnected } from '../config/db.js';

const recentActivity = [];
const MAX_MEMORY_ACTIVITY = 500;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_FIELDS = /password|token|secret|authorization|cookie|prescription|medical|otp|mobile|phone|email|address/i;

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
  const normalized = pathname.split('/').filter(part => part && !/^v\\d+$/i.test(part) && !['api', 'admin'].includes(part.toLowerCase()));
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
  const tenantId = context.tenantId || context.tenant?.id || req.get?.('x-tenant-id') || req.body?.tenantId || req.user?.tenantId || req.user?.app_metadata?.tenantId || null;
  const branchId = context.branchId || context.branch?.id || req.get?.('x-branch-id') || req.body?.branchId || req.user?.branchId || req.user?.app_metadata?.branchId || null;
  const changedFields = Object.keys(req.body || {}).filter(key => !SENSITIVE_FIELDS.test(key)).slice(0, 30);
  const idParam = Object.entries(req.params || {}).find(([key]) => /id$/i.test(key));
  return {
    tenantId: tenantId ? String(tenantId) : null,
    branchId: branchId ? String(branchId) : null,
    actorId: String(actor.sub || actor.id || actor.userId || 'unknown'),
    actorName: String(actor.user_metadata?.name || actor.user_metadata?.full_name || actor.name || actor.email || 'User'),
    actorRole: String(actor.app_metadata?.role || actor.role || context.role || 'user'),
    action,
    entityType,
    entityId: idParam ? String(idParam[1]) : (normalized.find(part => /^[a-f0-9]{16,}$/i.test(part)) || req.body?.tenantId || req.query?.tenantId || req.body?.branchId || null),
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
  if (!MUTATING_METHODS.has(String(req.method).toUpperCase())) return next();
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
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
  const filter = {};
  if (tenantId) filter.tenantId = String(tenantId);
  if (branchId) filter.$or = [{ branchId: String(branchId) }, { branchId: null }];
  if (getIsConnected()) {
    const [items, total] = await Promise.all([
      ActivityAudit.find(filter).sort({ createdAt: -1, _id: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      ActivityAudit.countDocuments(filter)
    ]);
    return { items, pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit), hasNextPage: safePage * safeLimit < total, hasPreviousPage: safePage > 1 } };
  }
  const filtered = recentActivity.filter(item => (!tenantId || item.tenantId === String(tenantId)) && (!branchId || !item.branchId || item.branchId === String(branchId)));
  const total = filtered.length;
  return { items: filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit), pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit), hasNextPage: safePage * safeLimit < total, hasPreviousPage: safePage > 1 } };
}
