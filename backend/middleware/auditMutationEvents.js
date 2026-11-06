import { domainEvents } from '../shared/events/DomainEvents.js';

const PLATFORM_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN']);
const clean = value => String(value ?? '').trim();

function routeKind(method, path) {
  if (path.startsWith('/api/surplus-savings/admin') || path.startsWith('/api/tenant/members')) return null;
  if (path.startsWith('/api/orders/')) return 'ORDER';
  if (path.startsWith('/api/admin/riders') || path.startsWith('/api/riders/')) return 'RIDER';
  if (path.startsWith('/api/v1/vendor/profile') && method !== 'GET') return 'TENANT_PROFILE';
  if (path.startsWith('/api/v1/admin/tenants')) return 'TENANT';
  if (path.startsWith('/api/tenant/branches')) return 'TENANT_BRANCH';
  return null;
}

function bodyEntity(body) {
  const root = body?.data || body || {};
  return root.order || root.tenant || root.rider || root.branch || root.member || root.data || root;
}

function eventName(kind, method, req, entity) {
  if (kind === 'ORDER') {
    const status = clean(req.body?.newStatus || req.body?.status || req.body?.decision || req.params?.step || entity?.status || entity?.orderStatus).toLowerCase();
    if (status.includes('reject')) return 'ORDER_REJECTED';
    if (status.includes('accept')) return 'ORDER_ACCEPTED';
    return method === 'POST' ? 'ORDER_CREATED' : 'ORDER_UPDATED';
  }
  if (kind === 'RIDER') return method === 'POST' ? 'RIDER_CREATED' : 'RIDER_UPDATED';
  if (kind === 'TENANT_PROFILE') return 'TENANT_PROFILE_UPDATED';
  if (kind === 'TENANT') return method === 'POST' ? 'TENANT_CREATED' : method === 'DELETE' ? 'TENANT_DELETED' : 'TENANT_UPDATED';
  if (kind === 'TENANT_BRANCH') return method === 'POST' ? 'TENANT_BRANCH_CREATED' : method === 'DELETE' ? 'TENANT_BRANCH_DELETED' : 'TENANT_BRANCH_UPDATED';
  return 'RECORD_UPDATED';
}

export default function auditMutationEvents(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  const path = String(req.originalUrl || req.path || '').split('?')[0];
  const kind = routeKind(method, path);
  if (!kind) return next();

  const originalJson = res.json.bind(res);
  let responseBody = null;
  res.json = body => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const entity = bodyEntity(responseBody);
    const actorRole = clean(req.user?.app_metadata?.role || req.user?.role || req.context?.role || 'system').toUpperCase();
    const platform = PLATFORM_ROLES.has(actorRole);
    const trustedTenantId = clean(
      req.authz?.tenantId || req.tenantMembership?.tenantId || req.context?.tenantId
      || req.user?.tenantId || req.user?.app_metadata?.tenantId
    );
    const selectedTenantId = platform
      ? clean(req.get('x-tenant-id') || req.body?.tenantId || req.query?.tenantId || entity?.tenantId || entity?.tenant?._id || entity?._id)
      : trustedTenantId || clean(entity?.tenantId || entity?.tenant?._id);
    if (!selectedTenantId) return;

    const branchId = clean(
      req.authz?.branchId || req.tenantMembership?.branchId || req.context?.branchId
      || req.user?.branchId || entity?.branchId || req.body?.branchId
    );
    const entityId = clean(
      entity?._id || entity?.id || req.params?.orderId || req.params?.riderId
      || req.params?.campaignId || req.params?.id || req.body?.orderId
      || req.body?.tenantId || req.body?.branchId || selectedTenantId
    );
    const changedFields = Object.keys(req.body || {}).filter(key =>
      !['password', 'token', 'accessToken', 'refreshToken', 'prescription', 'file', 'photo'].includes(key)
    ).slice(0, 30);
    const status = clean(req.body?.newStatus || req.body?.status || entity?.status || entity?.orderStatus);
    const details = {
      action: method,
      status: status || undefined,
      changedFields,
      ...(kind === 'ORDER' ? { orderId: entityId } : {}),
      ...(kind === 'RIDER' ? { riderId: entityId } : {}),
      ...(req.body?.reason ? { reason: clean(req.body.reason).slice(0, 160) } : {})
    };
    domainEvents.emitDomainEvent(eventName(kind, method, req, entity), entityId, details, req.user, selectedTenantId, branchId || null);
  });
  next();
}
