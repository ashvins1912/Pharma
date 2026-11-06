import express from 'express';
import TenantMembership from '../models/TenantMembership.js';
import TenantBranch from '../models/TenantBranch.js';
import UserProfile from '../models/UserProfile.js';
import tenantService from '../services/tenant-service/TenantService.js';
import { authenticateUser } from '../middleware/auth.js';
import { domainEvents } from '../shared/events/DomainEvents.js';

const router = express.Router();
router.use(authenticateUser);
const allowedRoles = new Set(['PHARMACY_STAFF', 'PHARMACIST', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'RIDER', 'TENANT_RIDER']);
const clean = value => String(value ?? '').trim();

async function scope(req, res) {
  const role = clean(req.user?.app_metadata?.role || req.user?.role).toUpperCase();
  const platform = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
  const tenantId = platform ? clean(req.get('x-tenant-id') || req.query.tenantId || req.body?.tenantId) : clean(req.user?.tenantId || req.user?.app_metadata?.tenantId);
  if (!tenantId) { res.status(403).json({ code: 'TENANT_CONTEXT_REQUIRED', message: 'Select a pharmacy first.' }); return null; }
  if (!platform) {
    const membership = await TenantMembership.findOne({ userId: clean(req.user?.sub), tenantId, status: 'ACTIVE' }).lean();
    if (!membership || !['TENANT_OWNER', 'TENANT_ADMIN'].includes(clean(membership.role).toUpperCase()) || membership.branchId) {
      res.status(403).json({ code: 'TENANT_ADMIN_REQUIRED', message: 'Only a tenant-wide owner or administrator can manage branch staff.' }); return null;
    }
  }
  const tenant = await tenantService.getTenantById(tenantId);
  if (!tenant || tenant.status !== 'ACTIVE') { res.status(404).json({ code: 'TENANT_NOT_FOUND', message: 'Active pharmacy not found.' }); return null; }
  return { tenantId };
}

router.get('/', async (req, res) => {
  try {
    const selected = await scope(req, res); if (!selected) return;
    const rows = await TenantMembership.find({ tenantId: selected.tenantId, branchId: { $ne: null } }).sort({ updatedAt: -1 }).lean();
    const ids = [...new Set(rows.map(row => String(row.userId)))];
    const profiles = ids.length ? await UserProfile.find({ $or: [
      { supabase_user_id: { $in: ids } }, { supabaseId: { $in: ids } }, { userId: { $in: ids } }
    ] }).select('supabase_user_id supabaseId userId name email').lean() : [];
    const profileMap = new Map();
    profiles.forEach(profile => [profile.supabase_user_id, profile.supabaseId, profile.userId].filter(Boolean).forEach(id => profileMap.set(String(id), profile)));
    return res.json({ success: true, members: rows.map(row => ({ ...row, id: String(row._id), name: profileMap.get(String(row.userId))?.name || '', email: profileMap.get(String(row.userId))?.email || '' })) });
  } catch { return res.status(503).json({ code: 'MEMBERS_UNAVAILABLE', message: 'Branch team could not be loaded.' }); }
});

router.post('/', async (req, res) => {
  try {
    const selected = await scope(req, res); if (!selected) return;
    let userId = clean(req.body?.userId);
    const email = clean(req.body?.email).toLowerCase();
    if (!userId && email) {
      const profile = await UserProfile.findOne({ email }).select('supabase_user_id supabaseId userId').lean();
      userId = clean(profile?.supabase_user_id || profile?.supabaseId || profile?.userId);
    }
    if (!userId) return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'No registered user matches this email. The user must register before assignment.' });
    const profile = await UserProfile.findOne({ $or: [
      { supabase_user_id: userId }, { supabaseId: userId }, { userId }
    ] }).select('supabase_user_id supabaseId userId').lean();
    if (!profile) return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'The selected account is not a registered Pharma user.' });
    const branchId = clean(req.body?.branchId);
    const role = clean(req.body?.role).toUpperCase();
    if (!allowedRoles.has(role)) return res.status(400).json({ code: 'INVALID_BRANCH_ROLE', message: 'Choose a branch-level role. Tenant owner/admin roles cannot be assigned here.' });
    const branch = await TenantBranch.findOne({ _id: branchId, tenantId: selected.tenantId, status: 'ACTIVE' }).select('_id').lean();
    if (!branch) return res.status(404).json({ code: 'BRANCH_NOT_FOUND', message: 'Choose an active branch belonging to this pharmacy.' });
    const existing = await TenantMembership.findOne({ userId, tenantId: selected.tenantId }).lean();
    if (existing && ['OWNER', 'TENANT_OWNER', 'TENANT_ADMIN'].includes(clean(existing.role).toUpperCase()) && !existing.branchId) {
      return res.status(409).json({ code: 'TENANT_ADMIN_PROTECTED', message: 'A tenant owner or tenant-wide administrator cannot be replaced by a branch assignment.' });
    }
    const member = await TenantMembership.findOneAndUpdate({ userId, tenantId: selected.tenantId }, {
      $set: { branchId, role, status: 'ACTIVE', invitedBy: clean(req.user?.sub) }
    }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }).lean();
    domainEvents.emitDomainEvent('TENANT_BRANCH_MEMBER_ASSIGNED', String(member._id), { userId, role, branchId }, req.user, selected.tenantId, branchId);
    return res.status(201).json({ success: true, member: { ...member, id: String(member._id), email }, message: 'Branch user assigned.' });
  } catch (error) { return res.status(400).json({ code: 'MEMBER_ASSIGN_FAILED', message: error.message || 'Could not assign branch user.' }); }
});

router.patch('/:membershipId', async (req, res) => {
  try {
    const selected = await scope(req, res); if (!selected) return;
    const current = await TenantMembership.findOne({ _id: req.params.membershipId, tenantId: selected.tenantId }).lean();
    if (!current) return res.status(404).json({ code: 'MEMBER_NOT_FOUND', message: 'Branch user assignment not found.' });
    if (['OWNER', 'TENANT_OWNER', 'TENANT_ADMIN'].includes(clean(current.role).toUpperCase()) && !current.branchId) {
      return res.status(409).json({ code: 'TENANT_ADMIN_PROTECTED', message: 'Tenant-wide owner/admin membership cannot be changed through branch staff management.' });
    }
    const updates = {};
    if (req.body?.role !== undefined) {
      const role = clean(req.body.role).toUpperCase();
      if (!allowedRoles.has(role)) return res.status(400).json({ code: 'INVALID_BRANCH_ROLE', message: 'Choose a branch-level role.' });
      updates.role = role;
    }
    if (req.body?.branchId !== undefined) {
      const branchId = clean(req.body.branchId);
      const branch = await TenantBranch.findOne({ _id: branchId, tenantId: selected.tenantId, status: 'ACTIVE' }).select('_id').lean();
      if (!branch) return res.status(404).json({ code: 'BRANCH_NOT_FOUND', message: 'Choose an active branch belonging to this pharmacy.' });
      updates.branchId = branchId;
    }
    if (req.body?.status !== undefined && ['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(clean(req.body.status).toUpperCase())) updates.status = clean(req.body.status).toUpperCase();
    if (Object.keys(updates).length === 0) return res.status(400).json({ code: 'NO_MEMBER_CHANGES', message: 'Provide a role, branch or status change.' });
    const member = await TenantMembership.findOneAndUpdate({ _id: current._id, tenantId: selected.tenantId }, { $set: updates }, { new: true, runValidators: true }).lean();
    domainEvents.emitDomainEvent('TENANT_BRANCH_MEMBER_UPDATED', String(member._id), { userId: member.userId, changes: Object.keys(updates), role: member.role, branchId: member.branchId, status: member.status }, req.user, selected.tenantId, member.branchId);
    return res.json({ success: true, member: { ...member, id: String(member._id) } });
  } catch (error) { return res.status(400).json({ code: 'MEMBER_UPDATE_FAILED', message: error.message || 'Could not update branch user.' }); }
});

export default router;
