import express from 'express';
import { authenticateUser } from '../../middleware/auth.js';
import { resolveUserContext } from '../../middleware/context.js';
import TenantMembership from '../../models/TenantMembership.js';
import TenantBranch from '../../models/TenantBranch.js';
import UserProfile from '../../models/UserProfile.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';

const router = express.Router({ mergeParams: true });
const ALLOWED_ROLES = new Set(['PHARMACY_STAFF', 'PHARMACIST', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'RIDER', 'TENANT_RIDER', 'TENANT_ADMIN']);
const ROLE_PERMISSION_PRESETS = {
  PHARMACY_STAFF: ['orders.read', 'inventory.read'],
  PHARMACIST: ['orders.read', 'orders.manage', 'inventory.read', 'medicine_requests.read', 'medicine_requests.manage'],
  ORDER_MANAGER: ['orders.read', 'orders.manage', 'medicine_requests.read', 'medicine_requests.manage'],
  INVENTORY_MANAGER: ['inventory.read', 'inventory.write'],
  DISPATCHER: ['orders.read', 'orders.manage', 'delivery.read', 'delivery.manage'],
  RIDER: ['delivery.read'],
  TENANT_RIDER: ['delivery.read'],
  TENANT_ADMIN: []
};
const clean = value => String(value ?? '').trim();

async function authorizeTenantManager(req, res) {
  resolveUserContext(req);
  const tenantId = clean(req.params.tenantId);
  const context = req.context || {};
  const authenticatedRole = clean(req.user?.app_metadata?.role || req.user?.role).toUpperCase();
  const platform = context.isPlatformUser === true || ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'ADMIN'].includes(authenticatedRole);
  let role = authenticatedRole || clean(context.role).toUpperCase();

  if (!platform) {
    if (String(context.tenantId || '') !== tenantId || context.tenantMismatch) {
      res.status(403).json({ success: false, code: 'TENANT_SCOPE_FORBIDDEN', message: 'You cannot manage users outside your selected pharmacy.' });
      return null;
    }
    const membership = await TenantMembership.findOne({
      userId: String(req.user?.sub || req.user?.id || ''),
      tenantId,
      status: 'ACTIVE'
    }).lean();
    if (!membership) {
      res.status(403).json({ success: false, code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active membership for this pharmacy is required.' });
      return null;
    }
    role = clean(membership.role).toUpperCase();
    if (!['TENANT_OWNER', 'TENANT_ADMIN'].includes(role) || membership.branchId) {
      res.status(403).json({ success: false, code: 'TENANT_ADMIN_REQUIRED', message: 'Only a tenant-wide owner or administrator can manage branch staff.' });
      return null;
    }
  } else if (!['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'ADMIN'].includes(role)) {
    res.status(403).json({ success: false, code: 'PLATFORM_ADMIN_REQUIRED', message: 'Platform administrator access is required.' });
    return null;
  }

  const tenant = await tenantService.getTenantById(tenantId);
  if (!tenant) {
    res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND', message: 'Pharmacy tenant not found.' });
    return null;
  }
  return { tenantId, actor: req.user, platform, role };
}

async function validateBranch(tenantId, branchId, res) {
  if (!branchId) return true;
  const branch = await TenantBranch.findOne({ _id: branchId, tenantId, status: 'ACTIVE' }).select('_id').lean();
  if (!branch) {
    res.status(400).json({ success: false, code: 'INVALID_BRANCH', message: 'Choose an active branch belonging to this pharmacy.' });
    return false;
  }
  return true;
}

router.use(authenticateUser);

router.get('/', async (req, res) => {
  try {
    const scope = await authorizeTenantManager(req, res);
    if (!scope) return;
    const memberships = await TenantMembership.find({ tenantId: scope.tenantId })
      .select('-invitationToken')
      .sort({ createdAt: -1, _id: -1 }).lean();
    const userIds = [...new Set(memberships.map(item => String(item.userId || '')).filter(Boolean))];
    const profiles = userIds.length ? await UserProfile.find({
      tenantId: scope.tenantId,
      $or: [
        { userId: { $in: userIds } },
        { supabaseId: { $in: userIds } },
        { supabase_user_id: { $in: userIds } }
      ]
    }).select('userId supabaseId supabase_user_id name firstName lastName email').lean() : [];
    const profileById = new Map();
    for (const profile of profiles) {
      for (const id of [profile.userId, profile.supabaseId, profile.supabase_user_id].filter(Boolean)) {
        profileById.set(String(id), profile);
      }
    }
    const data = memberships.map(item => {
      const profile = profileById.get(String(item.userId)) || {};
      return {
        ...item,
        name: profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' '),
        email: profile.email || ''
      };
    });
    return res.json({ success: true, data });
  } catch {
    return res.status(503).json({ success: false, code: 'STAFF_LIST_UNAVAILABLE', message: 'Pharmacy staff could not be loaded.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const scope = await authorizeTenantManager(req, res);
    if (!scope) return;
    const email = clean(req.body?.email).toLowerCase();
    const branchId = clean(req.body?.branchId) || null;
    const role = clean(req.body?.role).toUpperCase();
    const requestedPermissions = Array.isArray(req.body?.permissions)
      ? [...new Set(req.body.permissions.map(clean).filter(Boolean))]
      : (ROLE_PERMISSION_PRESETS[role] || []);
    const allowedPermissions = new Set(ROLE_PERMISSION_PRESETS[role] || []);
    if (requestedPermissions.some(permission => !allowedPermissions.has(permission))) {
      return res.status(400).json({ success: false, code: 'INVALID_ROLE_PERMISSIONS', message: 'The requested permissions are not part of this role preset.' });
    }
    const permissions = requestedPermissions;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, code: 'INVALID_STAFF_EMAIL', message: 'Enter a valid registered pharmacy user email.' });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ success: false, code: 'INVALID_STAFF_ROLE', message: 'Choose a supported pharmacy staff role.' });
    }
    if (role === 'TENANT_ADMIN' && !scope.platform && scope.role !== 'TENANT_OWNER') {
      return res.status(403).json({ success: false, code: 'OWNER_REQUIRED', message: 'Only the pharmacy owner or platform administrator can grant tenant administrator access.' });
    }
    if (role === 'TENANT_ADMIN' && branchId) {
      return res.status(400).json({ success: false, code: 'TENANT_ADMIN_MUST_BE_TENANT_WIDE', message: 'Tenant administrators must be assigned at tenant scope, not to a branch.' });
    }
    if (role !== 'TENANT_ADMIN' && !branchId) {
      return res.status(400).json({ success: false, code: 'BRANCH_REQUIRED', message: 'Choose an active branch for this staff role.' });
    }
    if (!await validateBranch(scope.tenantId, branchId, res)) return;

    const profile = await UserProfile.findOne({ tenantId: scope.tenantId, status: 'ACTIVE', $or: [{ email }, { normalizedEmail: email }] })
      .select('userId supabaseId supabase_user_id name email')
      .lean();
    const userId = String(profile?.userId || profile?.supabaseId || profile?.supabase_user_id || '');
    if (!userId) {
      return res.status(404).json({ success: false, code: 'REGISTERED_USER_NOT_FOUND', message: 'This email must belong to an active registered user of this pharmacy.' });
    }

    const existing = await TenantMembership.findOne({ userId, tenantId: scope.tenantId }).lean();
    const existingRole = clean(existing?.role).toUpperCase();
    if (existingRole === 'TENANT_OWNER') {
      return res.status(403).json({ success: false, code: 'OWNER_MEMBERSHIP_PROTECTED', message: 'A tenant owner membership cannot be replaced by staff assignment.' });
    }
    if (existingRole === 'TENANT_ADMIN' && !scope.platform && scope.role !== 'TENANT_OWNER') {
      return res.status(403).json({ success: false, code: 'TENANT_ADMIN_MEMBERSHIP_PROTECTED', message: 'Only the tenant owner or platform administrator can change a tenant administrator membership.' });
    }

    const membership = await TenantMembership.findOneAndUpdate(
      { userId, tenantId: scope.tenantId },
      { $set: { branchId, role, permissions, status: 'ACTIVE', invitedBy: String(scope.actor?.sub || scope.actor?.id || '') }, $setOnInsert: { invitationToken: null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    domainEvents.emitDomainEvent('TENANT_STAFF_ASSIGNED', membership._id, { userId, role, branchId }, scope.actor, scope.tenantId, branchId);
    return res.status(201).json({ success: true, data: membership, message: 'Staff membership saved.' });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: 'MEMBERSHIP_EXISTS', message: 'This user already has a membership for this pharmacy.' });
    return res.status(400).json({ success: false, code: 'STAFF_ASSIGNMENT_FAILED', message: error.message || 'Staff membership could not be saved.' });
  }
});

router.patch('/:membershipId', async (req, res) => {
  try {
    const scope = await authorizeTenantManager(req, res);
    if (!scope) return;
    const current = await TenantMembership.findOne({ _id: req.params.membershipId, tenantId: scope.tenantId }).lean();
    if (!current) return res.status(404).json({ success: false, code: 'MEMBERSHIP_NOT_FOUND', message: 'Staff membership not found.' });

    const currentRole = clean(current.role).toUpperCase();
    if (currentRole === 'TENANT_OWNER' && !scope.platform) {
      return res.status(403).json({ success: false, code: 'OWNER_MEMBERSHIP_PROTECTED', message: 'Only a platform administrator can change a tenant owner membership.' });
    }
    if (currentRole === 'TENANT_ADMIN' && !scope.platform && scope.role !== 'TENANT_OWNER') {
      return res.status(403).json({ success: false, code: 'ADMIN_MEMBERSHIP_PROTECTED', message: 'Only the pharmacy owner or platform administrator can change another administrator membership.' });
    }
    if (String(current.userId) === String(scope.actor?.sub || scope.actor?.id || '') && !scope.platform) {
      return res.status(403).json({ success: false, code: 'SELF_MEMBERSHIP_CHANGE_FORBIDDEN', message: 'You cannot change your own pharmacy membership.' });
    }

    const updates = {};
    if (req.body?.role !== undefined) {
      const role = clean(req.body.role).toUpperCase();
      if (!ALLOWED_ROLES.has(role)) return res.status(400).json({ success: false, code: 'INVALID_STAFF_ROLE', message: 'Choose a supported pharmacy staff role.' });
      if (role === 'TENANT_ADMIN' && !scope.platform && scope.role !== 'TENANT_OWNER') {
        return res.status(403).json({ success: false, code: 'OWNER_REQUIRED', message: 'Only the pharmacy owner or platform administrator can grant tenant administrator access.' });
      }
      updates.role = role;
    }
    let requestedPermissions = null;
    if (req.body?.permissions !== undefined) {
      if (!Array.isArray(req.body.permissions)) return res.status(400).json({ success: false, code: 'INVALID_PERMISSIONS', message: 'Permissions must be an array.' });
      requestedPermissions = [...new Set(req.body.permissions.map(clean).filter(Boolean))];
    }
    if (req.body?.branchId !== undefined) {
      updates.branchId = clean(req.body.branchId) || null;
      if (!await validateBranch(scope.tenantId, updates.branchId, res)) return;
    }

    const effectiveRole = updates.role || currentRole;
    const effectiveBranchId = updates.branchId !== undefined ? updates.branchId : (current.branchId || null);
    const allowedPermissions = new Set(ROLE_PERMISSION_PRESETS[effectiveRole] || []);
    if (requestedPermissions && requestedPermissions.some(permission => !allowedPermissions.has(permission))) {
      return res.status(400).json({ success: false, code: 'INVALID_ROLE_PERMISSIONS', message: 'The requested permissions are not part of this role preset.' });
    }
    if (requestedPermissions) updates.permissions = requestedPermissions;
    else if (updates.role) updates.permissions = ROLE_PERMISSION_PRESETS[effectiveRole] || [];
    if (effectiveRole === 'TENANT_ADMIN' && effectiveBranchId) {
      return res.status(400).json({ success: false, code: 'TENANT_ADMIN_MUST_BE_TENANT_WIDE', message: 'Tenant administrators must be assigned at tenant scope.' });
    }
    if (effectiveRole !== 'TENANT_ADMIN' && !effectiveBranchId) {
      return res.status(400).json({ success: false, code: 'BRANCH_REQUIRED', message: 'Choose an active branch for this staff role.' });
    }
    if (req.body?.status !== undefined) {
      const status = clean(req.body.status).toUpperCase();
      if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(status)) return res.status(400).json({ success: false, code: 'INVALID_MEMBERSHIP_STATUS', message: 'Status must be ACTIVE, SUSPENDED or REVOKED.' });
      updates.status = status;
    }

    const updated = await TenantMembership.findOneAndUpdate(
      { _id: current._id, tenantId: scope.tenantId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    domainEvents.emitDomainEvent('TENANT_STAFF_UPDATED', updated._id, { userId: updated.userId, changes: Object.keys(updates) }, scope.actor, scope.tenantId, updated.branchId);
    return res.json({ success: true, data: updated, message: 'Staff membership updated.' });
  } catch (error) {
    return res.status(400).json({ success: false, code: 'STAFF_UPDATE_FAILED', message: error.message || 'Staff membership could not be updated.' });
  }
});

router.delete('/:membershipId', async (req, res) => {
  try {
    const scope = await authorizeTenantManager(req, res);
    if (!scope) return;
    const current = await TenantMembership.findOne({ _id: req.params.membershipId, tenantId: scope.tenantId }).lean();
    if (!current) return res.status(404).json({ success: false, code: 'MEMBERSHIP_NOT_FOUND', message: 'Staff membership not found.' });

    const currentRole = clean(current.role).toUpperCase();
    if (currentRole === 'TENANT_OWNER' && !scope.platform) {
      return res.status(403).json({ success: false, code: 'OWNER_MEMBERSHIP_PROTECTED', message: 'Only a platform administrator can revoke a tenant owner membership.' });
    }
    if (currentRole === 'TENANT_ADMIN' && !scope.platform && scope.role !== 'TENANT_OWNER') {
      return res.status(403).json({ success: false, code: 'ADMIN_MEMBERSHIP_PROTECTED', message: 'Only the pharmacy owner or platform administrator can revoke another administrator membership.' });
    }
    if (String(current.userId) === String(scope.actor?.sub || scope.actor?.id || '') && !scope.platform) {
      return res.status(403).json({ success: false, code: 'SELF_MEMBERSHIP_CHANGE_FORBIDDEN', message: 'You cannot revoke your own pharmacy membership.' });
    }

    const updated = await TenantMembership.findOneAndUpdate(
      { _id: req.params.membershipId, tenantId: scope.tenantId },
      { $set: { status: 'REVOKED', invitationToken: null } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ success: false, code: 'MEMBERSHIP_NOT_FOUND', message: 'Staff membership not found.' });
    domainEvents.emitDomainEvent('TENANT_STAFF_REVOKED', updated._id, { userId: updated.userId }, scope.actor, scope.tenantId, updated.branchId);
    return res.json({ success: true, data: updated, message: 'Staff access revoked. Historical records are preserved.' });
  } catch (error) {
    return res.status(400).json({ success: false, code: 'STAFF_REVOKE_FAILED', message: error.message || 'Staff access could not be revoked.' });
  }
});

export default router;
