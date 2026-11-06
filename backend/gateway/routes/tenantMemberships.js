import express from 'express';
import { authenticateUser } from '../../middleware/auth.js';
import { resolveUserContext } from '../../middleware/context.js';
import TenantMembership from '../../models/TenantMembership.js';
import TenantBranch from '../../models/TenantBranch.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';

const router = express.Router({ mergeParams: true });
const ALLOWED_ROLES = new Set(['PHARMACY_STAFF', 'PHARMACIST', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'RIDER', 'TENANT_RIDER', 'TENANT_ADMIN']);
const clean = value => String(value ?? '').trim();

async function authorizeTenantManager(req, res) {
  resolveUserContext(req);
  const tenantId = clean(req.params.tenantId);
  const context = req.context || {};
  const platform = context.isPlatformUser === true;
  let role = clean(context.role || req.user?.app_metadata?.role || req.user?.role).toUpperCase();
  let membership = null;
  if (!platform) {
    if (String(context.tenantId || '') !== tenantId || context.tenantMismatch) {
      res.status(403).json({ success: false, code: 'TENANT_SCOPE_FORBIDDEN', message: 'You cannot manage users outside your selected pharmacy.' });
      return null;
    }
    membership = await TenantMembership.findOne({
      userId: String(req.user?.sub || ''),
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
  const branch = await TenantBranch.findOne({ _id: branchId, tenantId, status: 'ACTIVE' }).lean();
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
      .sort({ createdAt: -1, _id: -1 }).lean();
    return res.json({ success: true, data: memberships });
  } catch (error) {
    return res.status(503).json({ success: false, code: 'STAFF_LIST_UNAVAILABLE', message: 'Pharmacy staff could not be loaded.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const scope = await authorizeTenantManager(req, res);
    if (!scope) return;
    const userId = clean(req.body?.userId);
    const branchId = clean(req.body?.branchId) || null;
    const role = clean(req.body?.role).toUpperCase();
    const permissions = Array.isArray(req.body?.permissions)
      ? [...new Set(req.body.permissions.map(clean).filter(Boolean))]
      : [];
    if (!userId) return res.status(400).json({ success: false, code: 'USER_ID_REQUIRED', message: 'Enter the existing authenticated user ID to add staff.' });
    if (!ALLOWED_ROLES.has(role)) return res.status(400).json({ success: false, code: 'INVALID_STAFF_ROLE', message: 'Choose a supported pharmacy staff role.' });
    if (role === 'TENANT_ADMIN' && !scope.platform && scope.role !== 'TENANT_OWNER') return res.status(403).json({ success: false, code: 'OWNER_REQUIRED', message: 'Only the pharmacy owner or platform administrator can grant tenant administrator access.' });
    if (!await validateBranch(scope.tenantId, branchId, res)) return;
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
    const updates = {};
    if (req.body?.role !== undefined) {
      const role = clean(req.body.role).toUpperCase();
      if (!ALLOWED_ROLES.has(role)) return res.status(400).json({ success: false, code: 'INVALID_STAFF_ROLE', message: 'Choose a supported pharmacy staff role.' });
      if (role === 'TENANT_ADMIN' && !scope.platform && scope.role !== 'TENANT_OWNER') return res.status(403).json({ success: false, code: 'OWNER_REQUIRED', message: 'Only the pharmacy owner or platform administrator can grant tenant administrator access.' });
      updates.role = role;
    }
    if (req.body?.permissions !== undefined) {
      if (!Array.isArray(req.body.permissions)) return res.status(400).json({ success: false, code: 'INVALID_PERMISSIONS', message: 'Permissions must be an array.' });
      updates.permissions = [...new Set(req.body.permissions.map(clean).filter(Boolean))];
    }
    if (req.body?.branchId !== undefined) {
      updates.branchId = clean(req.body.branchId) || null;
      if (!await validateBranch(scope.tenantId, updates.branchId, res)) return;
    }
    if (req.body?.status !== undefined) {
      const status = clean(req.body.status).toUpperCase();
      if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(status)) return res.status(400).json({ success: false, code: 'INVALID_MEMBERSHIP_STATUS', message: 'Status must be ACTIVE, SUSPENDED or REVOKED.' });
      updates.status = status;
    }
    const updated = await TenantMembership.findOneAndUpdate(
      { _id: current._id, tenantId: scope.tenantId }, { $set: updates }, { new: true, runValidators: true }
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
