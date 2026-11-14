import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { isPermissionGranted } from '@pharma/service-kernel';
import UserProfile from '../models/UserProfile.js';
import User from '../models/User.js';
import { getIsConnected } from '../config/db.js';
import { authorizationService } from './AuthorizationService.js';
import {
  applyCatalogSnapshot,
  getCatalogDefinition,
  getRolePermissions,
  getRoleScope,
  isKnownPermission,
  syncCatalogToDatabase
} from './AuthorizationCatalogService.js';

const sensitiveActivitySchema = new mongoose.Schema({
  logId: { type: String, required: true, unique: true, immutable: true },
  actorId: { type: String, required: true, immutable: true, index: true },
  actorEmail: { type: String, default: '', immutable: true },
  actorRole: { type: String, required: true, immutable: true },
  actorTier: { type: String, enum: ['Admin', 'Staff', 'Customer'], required: true, immutable: true },
  action: { type: String, required: true, immutable: true, index: true },
  operation: { type: String, enum: ['display', 'modify'], required: true, immutable: true },
  resourceType: { type: String, required: true, immutable: true },
  targetId: { type: String, default: null, immutable: true },
  targetLabel: { type: String, default: null, immutable: true },
  outcome: { type: String, enum: ['ALLOWED', 'DENIED', 'FAILED'], required: true, immutable: true, index: true },
  reason: { type: String, default: '', immutable: true },
  before: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  after: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  ipAddress: { type: String, default: null, immutable: true },
  requestId: { type: String, default: null, immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true, index: true }
}, { versionKey: false, strict: true });

sensitiveActivitySchema.index({ occurredAt: -1, action: 1 });

export const SensitiveActivityLog =
  mongoose.models.SensitiveActivityLog ||
  mongoose.model('SensitiveActivityLog', sensitiveActivitySchema, 'sensitive_activity_logs');

export const CANONICAL_ROLES = Object.freeze({
  Admin: {
    tier: 'Admin',
    label: 'Admin',
    description: 'Full governance and operational authority across users, roles, permissions, and system configuration.',
    allowedOperations: ['display', 'modify'],
    mappedSystemRoles: ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin', 'TENANT_OWNER', 'TENANT_ADMIN', 'ADMIN'],
    defaultAssignableRole: 'TENANT_ADMIN',
    platformAssignableRole: 'SUPER_ADMIN',
    capabilities: ['*']
  },
  Staff: {
    tier: 'Staff',
    label: 'Staff',
    description: 'Operational pharmacy staff able to view and update orders, prescriptions, and inventory within assigned scope.',
    allowedOperations: ['display', 'modify'],
    mappedSystemRoles: ['PHARMACIST', 'PHARMACY_STAFF', 'pharmacy', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'STAFF'],
    defaultAssignableRole: 'PHARMACY_STAFF',
    capabilities: [
      'profile.read', 'profile.write', 'inventory.read', 'inventory.write',
      'orders.read', 'orders.create', 'orders.manage',
      'prescription.read', 'prescription.write', 'prescription.review',
      'medicine_requests.read', 'medicine_requests.pending_count', 'medicine_requests.proposal',
      'promotions.read', 'promotions.manage', 'delivery.read', 'delivery.manage'
    ]
  },
  Customer: {
    tier: 'Customer',
    label: 'Customer',
    description: 'Standard customer access limited to own orders, prescriptions, profile, and medicine requests.',
    allowedOperations: ['display'],
    mappedSystemRoles: ['CUSTOMER', 'customer'],
    defaultAssignableRole: 'CUSTOMER',
    capabilities: [
      'profile.read', 'profile.write',
      'orders.read', 'orders.create',
      'prescription.read', 'prescription.write',
      'medicine_requests.read', 'medicine_requests.create', 'medicine_requests.decide'
    ]
  }
});

const SYSTEM_TO_TIER = new Map([
  ['ADMIN', 'Admin'],
  ['SUPER_ADMIN', 'Admin'],
  ['PLATFORM_SUPER_ADMIN', 'Admin'],
  ['TENANT_OWNER', 'Admin'],
  ['TENANT_ADMIN', 'Admin'],
  ['STAFF', 'Staff'],
  ['PHARMACIST', 'Staff'],
  ['PHARMACY_STAFF', 'Staff'],
  ['PHARMACY', 'Staff'],
  ['INVENTORY_MANAGER', 'Staff'],
  ['ORDER_MANAGER', 'Staff'],
  ['CUSTOMER', 'Customer']
]);

const PLATFORM_ROOT_ROLES = new Set(['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin']);
const SENSITIVE_ADMIN_PERMISSIONS = new Set([
  'users.read',
  'users.manage',
  'rbac.display',
  'rbac.modify',
  'rbac.assign',
  'tenants.read',
  'tenants.manage',
  'platform.*'
]);

const memoryActivityLogs = [];
const MAX_MEMORY_LOGS = 250;

function pushMemoryActivityLog(entry) {
  memoryActivityLogs.unshift(entry);
  if (memoryActivityLogs.length > MAX_MEMORY_LOGS) {
    memoryActivityLogs.length = MAX_MEMORY_LOGS;
  }
}

export function resolveCanonicalTier(roleInput) {
  const candidates = Array.isArray(roleInput) ? roleInput : [roleInput];
  let best = 'Customer';
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim().toUpperCase();
    const mapped = SYSTEM_TO_TIER.get(normalized);
    if (mapped === 'Admin') return 'Admin';
    if (mapped === 'Staff') best = 'Staff';
  }
  return best;
}

function normalizeTargetRole(roleInput) {
  const raw = String(roleInput || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === 'ADMIN') return 'TENANT_ADMIN';
  if (upper === 'STAFF') return 'PHARMACY_STAFF';
  if (upper === 'CUSTOMER') return 'CUSTOMER';
  const catalog = getCatalogDefinition();
  if (Object.prototype.hasOwnProperty.call(catalog.rolePermissions, raw)) return raw;
  const matched = Object.keys(catalog.rolePermissions).find(k => k.toUpperCase() === upper);
  return matched || null;
}

function hasGovernancePermission(subject, permission, operation) {
  const tier = resolveCanonicalTier(subject?.roles?.length ? subject.roles : subject?.role);
  const roleUpper = String(subject?.role || subject?.app_metadata?.role || '').toUpperCase();
  const revoked = Array.isArray(subject?.revokedPermissions)
    ? subject.revokedPermissions
    : (Array.isArray(subject?.app_metadata?.revokedPermissions) ? subject.app_metadata.revokedPermissions : []);

  if (permission && (
    revoked.includes(permission) ||
    revoked.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)))
  )) {
    return { allowed: false, tier, reason: `Permission "${permission}" is explicitly revoked.` };
  }

  if (['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'ADMIN'].includes(roleUpper) && subject?.scope !== 'TENANT') {
    return { allowed: true, tier: 'Admin', reason: 'Platform administrator authority.' };
  }

  if (tier === 'Customer') {
    if (permission && SENSITIVE_ADMIN_PERMISSIONS.has(permission)) {
      return { allowed: false, tier, reason: 'Customer role cannot perform administrative operations.' };
    }
    if (operation === 'modify' && permission && (permission.endsWith('.manage') || permission.startsWith('rbac.') || permission.startsWith('users.'))) {
      return { allowed: false, tier, reason: 'Customer role cannot execute modify governance operations.' };
    }
  }

  if (tier === 'Staff' && operation === 'modify' && permission && SENSITIVE_ADMIN_PERMISSIONS.has(permission)) {
    return { allowed: false, tier, reason: 'Staff role cannot execute administrative RBAC/user modify operations.' };
  }

  if (!permission) {
    if (operation === 'modify' && tier === 'Customer') {
      return { allowed: false, tier, reason: 'Modify operations require Staff or Admin authorization.' };
    }
    if (operation === 'display' && tier === 'Customer') {
      return { allowed: false, tier, reason: 'Administrative display operations require Staff or Admin authorization.' };
    }
    return { allowed: true, tier, reason: 'Tier authorization satisfied.' };
  }

  // Map rbac.* pseudo-permissions seamlessly to users.* governance permissions as well
  const aliases = {
    'rbac.display': ['users.read'],
    'rbac.modify': ['users.manage'],
    'rbac.assign': ['users.manage']
  };
  const granted = isPermissionGranted({ subject, permission, aliases });
  if (!granted) {
    return { allowed: false, tier, reason: `Missing required permission "${permission}" for ${operation} operation.` };
  }
  return { allowed: true, tier, reason: 'Permission verified.' };
}

const defaultIsDbReady = () => Boolean(getIsConnected() && mongoose.connection?.readyState === 1);

export function createCentralRbacService({
  userProfileModel = UserProfile,
  userModel = User,
  activityLogModel = SensitiveActivityLog,
  isDbConnected = defaultIsDbReady
} = {}) {
  async function logSensitiveAction({
    actor = {},
    action,
    operation = 'modify',
    resourceType = 'rbac',
    targetId = null,
    targetLabel = null,
    outcome = 'ALLOWED',
    reason = '',
    before = null,
    after = null,
    ipAddress = null,
    requestId = null
  }) {
    const actorId = String(actor.sub || actor.id || actor.userId || 'anonymous');
    const actorRole = String(actor.role || actor.app_metadata?.role || 'customer');
    const actorTier = resolveCanonicalTier(actor.roles?.length ? actor.roles : actorRole);

    const entry = {
      logId: `act-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      actorId,
      actorEmail: String(actor.email || ''),
      actorRole,
      actorTier,
      action: String(action || 'SENSITIVE_ACTION'),
      operation: operation === 'display' ? 'display' : 'modify',
      resourceType: String(resourceType || 'rbac'),
      targetId: targetId ? String(targetId) : null,
      targetLabel: targetLabel ? String(targetLabel) : null,
      outcome: ['ALLOWED', 'DENIED', 'FAILED'].includes(outcome) ? outcome : 'ALLOWED',
      reason: String(reason || '').slice(0, 400),
      before,
      after,
      ipAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
      requestId: requestId ? String(requestId).slice(0, 128) : null,
      occurredAt: new Date()
    };

    pushMemoryActivityLog(entry);

    if (isDbConnected()) {
      try {
        await activityLogModel.create(entry);
      } catch (err) {
        console.warn('[CentralRbacService] Persisting activity log failed:', err.message);
      }
    }
    return entry;
  }

  async function resolveSubjectContext(user) {
    if (!user || (!user.sub && !user.id && !user.userId)) {
      const err = new Error('Authentication session required.');
      err.code = 'UNAUTHORIZED';
      err.status = 401;
      throw err;
    }
    const dbOnline = defaultIsDbReady();
    if (dbOnline) {
      try {
        return await authorizationService.resolve(user);
      } catch (err) {
        if (err.code === 'TENANT_ACCESS_DENIED') throw err;
      }
    }
    const role = String(user.app_metadata?.role || user.role || 'customer');
    const perms = Array.isArray(user.permissions)
      ? user.permissions
      : (Array.isArray(user.app_metadata?.permissions) ? user.app_metadata.permissions : await getRolePermissions(role));
    return {
      sub: user.sub || user.id || user.userId,
      email: user.email || '',
      role,
      roles: Array.isArray(user.roles) ? user.roles : [role],
      tenantId: user.tenantId || user.app_metadata?.tenantId || null,
      scope: PLATFORM_ROOT_ROLES.has(role) ? 'PLATFORM' : getRoleScope(role),
      permissions: perms,
      revokedPermissions: Array.isArray(user.revokedPermissions)
        ? user.revokedPermissions
        : (Array.isArray(user.app_metadata?.revokedPermissions) ? user.app_metadata.revokedPermissions : [])
    };
  }

  async function validateOperationPermission({ user, operation = 'display', permission = null }) {
    if (!['display', 'modify'].includes(operation)) {
      throw new Error(`Unsupported RBAC operation mode "${operation}". Expected 'display' or 'modify'.`);
    }
    const context = await resolveSubjectContext(user);
    const mergedSubject = {
      ...context,
      email: user?.email || context.email || '',
      permissions: Array.isArray(context.permissions) && context.permissions.length
        ? context.permissions
        : (await getRolePermissions(context.role))
    };
    const check = hasGovernancePermission(mergedSubject, permission, operation);
    return {
      allowed: check.allowed,
      reason: check.reason,
      tier: check.tier,
      context: mergedSubject
    };
  }

  function requireOperation(operation, permission = null, { resourceType = 'rbac', auditOnAllow = false } = {}) {
    return async (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            error: { code: 'SESSION_REQUIRED', message: 'Authentication session required.' },
            requestId: req.requestId || req.context?.requestId || null
          });
        }
        const evaluation = await validateOperationPermission({
          user: req.user,
          operation,
          permission
        });
        req.authz = evaluation.context;
        req.rbacTier = evaluation.tier;

        if (!evaluation.allowed) {
          await logSensitiveAction({
            actor: { ...req.user, ...evaluation.context },
            action: `${operation.toUpperCase()}_ACCESS_DENIED`,
            operation,
            resourceType,
            targetId: req.params?.userId || req.params?.roleCode || req.originalUrl || null,
            outcome: 'DENIED',
            reason: evaluation.reason,
            ipAddress: req.ip || req.socket?.remoteAddress || null,
            requestId: req.requestId || req.context?.requestId || null
          });
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: evaluation.reason || 'You do not have permission to execute this operation.',
              operation,
              permission,
              tier: evaluation.tier
            },
            requestId: req.requestId || req.context?.requestId || null
          });
        }

        if (auditOnAllow) {
          await logSensitiveAction({
            actor: { ...req.user, ...evaluation.context },
            action: `${operation.toUpperCase()}_ACCESS_GRANTED`,
            operation,
            resourceType,
            targetId: req.params?.userId || req.params?.roleCode || req.originalUrl || null,
            outcome: 'ALLOWED',
            reason: `${operation} permission verified (${permission || 'tier-check'})`,
            ipAddress: req.ip || req.socket?.remoteAddress || null,
            requestId: req.requestId || req.context?.requestId || null
          });
        }

        return next();
      } catch (err) {
        return res.status(err.status || 403).json({
          success: false,
          error: { code: err.code || 'AUTHORIZATION_FAILED', message: err.message || 'Access denied.' },
          requestId: req.requestId || req.context?.requestId || null
        });
      }
    };
  }

  function getRoleDefinitions() {
    const catalog = getCatalogDefinition();
    const systemRoles = Object.entries(catalog.rolePermissions).map(([code, permissions]) => ({
      code,
      scope: catalog.roleScope[code] || 'CUSTOMER',
      canonicalTier: resolveCanonicalTier(code),
      isProtected: PLATFORM_ROOT_ROLES.has(code),
      allowedOperations: resolveCanonicalTier(code) === 'Customer' ? ['display'] : ['display', 'modify'],
      permissions: [...permissions]
    }));

    return {
      canonicalTiers: Object.values(CANONICAL_ROLES),
      systemRoles,
      features: catalog.features,
      availablePermissions: catalog.permissions.map(([feature, action]) => `${feature}.${action}`)
    };
  }

  async function listUsers({ search = '', tier = 'ALL', actorContext = null } = {}) {
    if (!isDbConnected()) {
      return [];
    }

    const filter = { accountStatus: { $ne: 'DELETED' } };
    const isPlatformAdmin = !actorContext || (
      actorContext.scope === 'PLATFORM' &&
      PLATFORM_ROOT_ROLES.has(actorContext.role)
    );
    if (!isPlatformAdmin && actorContext?.tenantId) {
      filter.tenantId = String(actorContext.tenantId);
    }

    const trimmed = String(search || '').trim();
    if (trimmed) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { name: rx },
        { email: rx },
        { normalizedEmail: rx },
        { role: rx },
        { userId: rx },
        { supabase_user_id: rx }
      ];
    }

    const users = await userProfileModel
      .find(filter)
      .select('userId supabase_user_id supabaseId name firstName lastName email role roles tenantId branchId permissions accessGrants accessRevokes permissionVersion accountStatus updatedAt')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();

    const mapped = await Promise.all(users.map(async u => {
      const rolePerms = await getRolePermissions(u.role);
      const canonicalTier = resolveCanonicalTier(u.roles?.length ? [u.role, ...u.roles] : u.role);
      return {
        id: u.userId || u.supabase_user_id || u.supabaseId,
        name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unnamed User',
        email: u.email,
        role: u.role,
        roles: Array.isArray(u.roles) && u.roles.length ? u.roles : [u.role],
        canonicalTier,
        tenantId: u.tenantId || null,
        branchId: u.branchId || null,
        accountStatus: u.accountStatus || 'ACTIVE',
        rolePermissions: rolePerms,
        accessGrants: u.accessGrants || [],
        accessRevokes: u.accessRevokes || [],
        permissionVersion: Number(u.permissionVersion || 1),
        isProtectedAdmin: PLATFORM_ROOT_ROLES.has(u.role)
      };
    }));

    if (tier && tier !== 'ALL') {
      return mapped.filter(u => u.canonicalTier === tier);
    }
    return mapped;
  }

  async function assignUserRole({
    actor,
    targetUserId,
    role,
    grants = undefined,
    revokes = undefined,
    reason = '',
    requestMeta = {}
  } = {}) {
    const cleanTargetId = String(targetUserId || '').trim();
    if (!cleanTargetId) {
      throw Object.assign(new Error('Target user ID is required.'), { code: 'USER_ID_REQUIRED', statusCode: 400 });
    }
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 3 || cleanReason.length > 240) {
      throw Object.assign(new Error('Provide an audit reason (3-240 characters) for sensitive role or permission updates.'), {
        code: 'AUDIT_REASON_REQUIRED',
        statusCode: 400
      });
    }

    const actorId = String(actor?.sub || actor?.id || actor?.userId || '');
    if (actorId && actorId === cleanTargetId) {
      throw Object.assign(new Error('You cannot reassign your own administrative role.'), {
        code: 'SELF_ROLE_CHANGE_BLOCKED',
        statusCode: 403
      });
    }

    if (!isDbConnected()) {
      throw Object.assign(new Error('User directory database is currently offline.'), {
        code: 'DATABASE_UNAVAILABLE',
        statusCode: 503
      });
    }

    const target = await userProfileModel.findOne({
      $or: [{ userId: cleanTargetId }, { supabase_user_id: cleanTargetId }, { supabaseId: cleanTargetId }]
    });
    if (!target) {
      throw Object.assign(new Error('Target user profile was not found.'), { code: 'USER_NOT_FOUND', statusCode: 404 });
    }

    const actorIsPlatformRoot = PLATFORM_ROOT_ROLES.has(String(actor?.role || '')) && actor?.scope !== 'TENANT';
    if (!actorIsPlatformRoot) {
      if (PLATFORM_ROOT_ROLES.has(target.role)) {
        throw Object.assign(new Error('Only a Platform Super Admin may modify a Platform Super Admin account.'), {
          code: 'INSUFFICIENT_PRIVILEGE',
          statusCode: 403
        });
      }
      if (!actor?.tenantId || String(target.tenantId || '') !== String(actor.tenantId)) {
        throw Object.assign(new Error('You may only assign roles to users within your own tenant.'), {
          code: 'TENANT_SCOPE_VIOLATION',
          statusCode: 403
        });
      }
    }

    const beforeSnapshot = {
      role: target.role,
      roles: [...(target.roles || [])],
      tier: resolveCanonicalTier(target.role),
      accessGrants: [...(target.accessGrants || [])],
      accessRevokes: [...(target.accessRevokes || [])],
      permissionVersion: Number(target.permissionVersion || 1)
    };

    let nextRole = target.role;
    if (role !== undefined && role !== null && String(role).trim() !== '') {
      const normalized = normalizeTargetRole(role);
      if (!normalized) {
        throw Object.assign(new Error(`Unsupported role "${role}".`), { code: 'INVALID_ROLE', statusCode: 400 });
      }
      if (!actorIsPlatformRoot && PLATFORM_ROOT_ROLES.has(normalized)) {
        throw Object.assign(new Error('Only a Platform Super Admin can assign SUPER_ADMIN privileges.'), {
          code: 'PRIVILEGE_ESCALATION_BLOCKED',
          statusCode: 403
        });
      }
      if (PLATFORM_ROOT_ROLES.has(target.role) && !PLATFORM_ROOT_ROLES.has(normalized)) {
        const superAdminCount = await userProfileModel.countDocuments({
          role: { $in: ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin'] },
          accountStatus: 'ACTIVE'
        });
        if (superAdminCount <= 1) {
          throw Object.assign(new Error('Cannot demote the last active Super Admin.'), {
            code: 'LAST_SUPER_ADMIN_PROTECTED',
            statusCode: 409
          });
        }
      }
      nextRole = normalized;
    }

    const sanitizePerms = value => [
      ...new Set(
        (Array.isArray(value) ? value : [])
          .map(v => String(v || '').trim())
          .filter(v => v && !v.includes('*') && isKnownPermission(v))
      )
    ];

    const nextGrants = grants !== undefined ? sanitizePerms(grants) : [...(target.accessGrants || [])];
    const nextRevokes = revokes !== undefined ? sanitizePerms(revokes) : [...(target.accessRevokes || [])];

    if (PLATFORM_ROOT_ROLES.has(nextRole) && nextRevokes.length > 0) {
      throw Object.assign(new Error('Platform Super Admin accounts cannot have permissions revoked.'), {
        code: 'SUPER_ADMIN_LOCKED',
        statusCode: 409
      });
    }

    target.role = nextRole;
    target.roles = [nextRole];
    target.accessGrants = nextGrants;
    target.accessRevokes = nextRevokes;
    target.permissionVersion = Number(target.permissionVersion || 1) + 1;
    await target.save();

    await userModel.updateMany(
      { $or: [{ userId: cleanTargetId }, { supabase_user_id: cleanTargetId }] },
      { $set: { role: nextRole, roles: [nextRole] } }
    ).catch(() => {});

    const afterSnapshot = {
      role: target.role,
      roles: [...(target.roles || [])],
      tier: resolveCanonicalTier(target.role),
      accessGrants: [...(target.accessGrants || [])],
      accessRevokes: [...(target.accessRevokes || [])],
      permissionVersion: target.permissionVersion
    };

    const actionName = beforeSnapshot.role !== afterSnapshot.role ? 'ROLE_ASSIGNED' : 'USER_PERMISSIONS_UPDATED';
    const activityEntry = await logSensitiveAction({
      actor,
      action: actionName,
      operation: 'modify',
      resourceType: 'user_role',
      targetId: cleanTargetId,
      targetLabel: target.email || target.name || cleanTargetId,
      outcome: 'ALLOWED',
      reason: cleanReason,
      before: beforeSnapshot,
      after: afterSnapshot,
      ipAddress: requestMeta.ipAddress || null,
      requestId: requestMeta.requestId || null
    });

    const rolePerms = await getRolePermissions(target.role);

    return {
      user: {
        id: target.userId || target.supabase_user_id || target.supabaseId,
        name: target.name,
        email: target.email,
        role: target.role,
        roles: target.roles,
        canonicalTier: resolveCanonicalTier(target.role),
        tenantId: target.tenantId || null,
        rolePermissions: rolePerms,
        accessGrants: target.accessGrants || [],
        accessRevokes: target.accessRevokes || [],
        permissionVersion: target.permissionVersion,
        isProtectedAdmin: PLATFORM_ROOT_ROLES.has(target.role)
      },
      activityLog: activityEntry
    };
  }

  async function updateRolePermissions({
    actor,
    roleCode,
    permissions = [],
    reason = '',
    requestMeta = {}
  } = {}) {
    const normalizedRole = normalizeTargetRole(roleCode);
    if (!normalizedRole) {
      throw Object.assign(new Error(`Unknown role "${roleCode}".`), { code: 'INVALID_ROLE', statusCode: 400 });
    }
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 3 || cleanReason.length > 240) {
      throw Object.assign(new Error('Provide an audit reason (3-240 characters) for modifying role permissions.'), {
        code: 'AUDIT_REASON_REQUIRED',
        statusCode: 400
      });
    }
    if (PLATFORM_ROOT_ROLES.has(normalizedRole)) {
      throw Object.assign(new Error(`Platform root role "${normalizedRole}" permissions are locked to full access (*).`), {
        code: 'SUPER_ADMIN_LOCKED',
        statusCode: 409
      });
    }

    const catalog = getCatalogDefinition();
    const cleanedPerms = [
      ...new Set(
        (Array.isArray(permissions) ? permissions : [])
          .map(p => String(p || '').trim())
          .filter(p => p && isKnownPermission(p))
      )
    ];

    const previousPerms = [...(catalog.rolePermissions[normalizedRole] || [])];
    const updatedCatalog = {
      ...catalog,
      rolePermissions: {
        ...catalog.rolePermissions,
        [normalizedRole]: cleanedPerms
      }
    };

    applyCatalogSnapshot(updatedCatalog);
    const dbSync = await syncCatalogToDatabase({ deactivateMissing: true });

    let bumpedUsers = 0;
    if (isDbConnected()) {
      const bump = await userProfileModel.updateMany(
        { $or: [{ role: normalizedRole }, { roles: normalizedRole }] },
        { $inc: { permissionVersion: 1 } }
      );
      bumpedUsers = Number(bump?.modifiedCount || 0);
    }

    const activityEntry = await logSensitiveAction({
      actor,
      action: 'ROLE_PERMISSIONS_UPDATED',
      operation: 'modify',
      resourceType: 'role_policy',
      targetId: normalizedRole,
      targetLabel: `${normalizedRole} (${resolveCanonicalTier(normalizedRole)})`,
      outcome: 'ALLOWED',
      reason: cleanReason,
      before: { permissions: previousPerms },
      after: { permissions: cleanedPerms },
      ipAddress: requestMeta.ipAddress || null,
      requestId: requestMeta.requestId || null
    });

    return {
      role: normalizedRole,
      canonicalTier: resolveCanonicalTier(normalizedRole),
      permissions: cleanedPerms,
      databaseSync: dbSync,
      bumpedUsers,
      activityLog: activityEntry
    };
  }

  async function listActivityLogs({ limit = 50, action = '', outcome = '', search = '' } = {}) {
    const cappedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    let rows = [];

    if (isDbConnected()) {
      const query = {};
      if (action) query.action = String(action).trim();
      if (outcome) query.outcome = String(outcome).trim().toUpperCase();
      if (search) {
        const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(escaped, 'i');
        query.$or = [
          { actorEmail: rx },
          { actorId: rx },
          { targetLabel: rx },
          { targetId: rx },
          { action: rx },
          { reason: rx }
        ];
      }
      rows = await activityLogModel.find(query).sort({ occurredAt: -1 }).limit(cappedLimit).lean();
    }

    // Merge memory fallback entries (deduplicated by logId) so local/offline events are always visible
    const seen = new Set(rows.map(r => r.logId));
    for (const mem of memoryActivityLogs) {
      if (seen.has(mem.logId)) continue;
      if (action && mem.action !== action) continue;
      if (outcome && mem.outcome !== outcome.toUpperCase()) continue;
      if (search) {
        const q = String(search).trim().toLowerCase();
        const hay = `${mem.actorEmail} ${mem.actorId} ${mem.targetLabel} ${mem.targetId} ${mem.action} ${mem.reason}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push(mem);
      seen.add(mem.logId);
    }

    rows.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    return rows.slice(0, cappedLimit);
  }

  return {
    logSensitiveAction,
    validateOperationPermission,
    requireOperation,
    requireDisplayPermission: (permission = null, options = {}) => requireOperation('display', permission, options),
    requireModifyPermission: (permission = null, options = {}) => requireOperation('modify', permission, options),
    getRoleDefinitions,
    listUsers,
    assignUserRole,
    updateRolePermissions,
    listActivityLogs
  };
}

export const centralRbacService = createCentralRbacService();
export const requireOperationPermission = (operation, permission = null, options = {}) =>
  centralRbacService.requireOperation(operation, permission, options);
export const requireDisplayPermission = (permission = null, options = {}) =>
  centralRbacService.requireDisplayPermission(permission, options);
export const requireModifyPermission = (permission = null, options = {}) =>
  centralRbacService.requireModifyPermission(permission, options);
