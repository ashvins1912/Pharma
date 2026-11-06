import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import TenantMembership from '../models/TenantMembership.js';
import TenantBranch from '../models/TenantBranch.js';
import tenantService from '../services/tenant-service/TenantService.js';

const router = express.Router();
router.use(authenticateUser);

const PLATFORM_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN']);
const TENANT_ADMIN_ROLES = new Set(['TENANT_OWNER', 'TENANT_ADMIN', 'OWNER']);
const clean = value => String(value ?? '').trim();

async function resolveScope(req, res, { requireAdmin = false } = {}) {
  const role = clean(req.user?.app_metadata?.role || req.user?.role).toUpperCase();
  const platform = PLATFORM_ROLES.has(role);
  const authenticatedTenantId = clean(req.user?.tenantId || req.user?.app_metadata?.tenantId);
  const tenantId = platform
    ? clean(req.get('x-tenant-id') || req.query.tenantId || req.body?.tenantId)
    : authenticatedTenantId;

  if (!tenantId) {
    res.status(403).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'Select an authorized pharmacy tenant first.' });
    return null;
  }

  let membership = null;
  if (!platform) {
    membership = await TenantMembership.findOne({
      userId: clean(req.user?.sub),
      tenantId,
      status: 'ACTIVE'
    }).lean();
    if (!membership) {
      res.status(403).json({ success: false, code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active membership for this pharmacy is required.' });
      return null;
    }
    const membershipRole = clean(membership.role).toUpperCase();
    if (requireAdmin && (!TENANT_ADMIN_ROLES.has(membershipRole) || membership.branchId)) {
      res.status(403).json({ success: false, code: 'TENANT_BRANCH_ADMIN_REQUIRED', message: 'Only a tenant-wide pharmacy owner or administrator can manage branches.' });
      return null;
    }
  }
  const tenant = await tenantService.getTenantById(tenantId);
  if (!tenant || (!platform && tenant.status !== 'ACTIVE')) {
    res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND', message: 'The selected active pharmacy tenant was not found.' });
    return null;
  }
  return { tenantId, platform, membership, tenant };
}

function normalizeBranchPayload(body = {}) {
  const address = body.address && typeof body.address === 'object' ? body.address : {};
  return {
    name: clean(body.name),
    code: clean(body.code).toUpperCase(),
    phone: clean(body.phone),
    email: clean(body.email).toLowerCase(),
    geolocation: {
      latitude: body.geolocation?.latitude === '' || body.geolocation?.latitude == null ? null : Number(body.geolocation.latitude),
      longitude: body.geolocation?.longitude === '' || body.geolocation?.longitude == null ? null : Number(body.geolocation.longitude)
    },
    address: {
      street: clean(address.street),
      city: clean(address.city),
      state: clean(address.state),
      pincode: clean(address.pincode || address.zipCode)
    },
    serviceRadiusKm: body.serviceRadiusKm === '' || body.serviceRadiusKm == null ? 10 : Number(body.serviceRadiusKm),
    deliveryMode: clean(body.deliveryMode) || 'OWN_RIDER',
    minimumOrderValue: body.minimumOrderValue === '' || body.minimumOrderValue == null ? 149 : Number(body.minimumOrderValue),
    freeDeliveryAbove: body.freeDeliveryAbove === '' || body.freeDeliveryAbove == null ? 499 : Number(body.freeDeliveryAbove),
    deliveryFee: body.deliveryFee === '' || body.deliveryFee == null ? 30 : Number(body.deliveryFee),
    operatingHours: {
      open: clean(body.operatingHours?.open) || '08:00',
      close: clean(body.operatingHours?.close) || '22:00'
    }
  };
}

function validateBranch(data) {
  if (!data.name || !data.code) return 'Branch name and branch code are required.';
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(data.code)) return 'Branch code must be 2–20 characters and contain only letters, numbers, hyphens or underscores.';
  const { latitude, longitude } = data.geolocation;
  if ((latitude == null) !== (longitude == null)) return 'Enter both latitude and longitude, or leave both empty.';
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) return 'Latitude must be between -90 and 90.';
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return 'Longitude must be between -180 and 180.';
  for (const key of ['serviceRadiusKm', 'minimumOrderValue', 'freeDeliveryAbove', 'deliveryFee']) {
    if (!Number.isFinite(data[key]) || data[key] < 0) return 'Delivery and service values must be valid non-negative numbers.';
  }
  return null;
}

router.get('/', async (req, res) => {
  try {
    const scope = await resolveScope(req);
    if (!scope) return;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const status = clean(req.query.status).toUpperCase();
    const all = await tenantService.getBranches(scope.tenantId, status && ['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status) ? { status } : {});
    const branches = scope.platform || !scope.membership?.branchId
      ? all
      : all.filter(branch => String(branch.id || branch._id) === String(scope.membership.branchId));
    const total = branches.length;
    return res.json({ success: true, usesTenantAsBranch: scope.tenant.usesTenantAsBranch === true, branches: branches.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    return res.status(503).json({ success: false, code: 'TENANT_BRANCH_REGISTRY_UNAVAILABLE', message: 'Pharmacy branches are temporarily unavailable.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const scope = await resolveScope(req, res, { requireAdmin: true });
    if (!scope) return;
    if (scope.tenant.usesTenantAsBranch === true) return res.status(409).json({ success: false, code: 'TENANT_IS_MAIN_BRANCH', message: 'This pharmacy is using its tenant location as its main branch. Turn off that option in Tenant Profile before adding separate branches.' });
    const data = normalizeBranchPayload(req.body);
    const invalid = validateBranch(data);
    if (invalid) return res.status(400).json({ success: false, code: 'INVALID_BRANCH', message: invalid });
    const duplicate = await TenantBranch.findOne({ tenantId: scope.tenantId, code: data.code }).lean();
    if (duplicate) return res.status(409).json({ success: false, code: 'BRANCH_CODE_EXISTS', message: 'This branch code is already used by this pharmacy.' });
    const branch = await tenantService.createBranch(scope.tenantId, data, { userId: req.user?.sub });
    // Pending branches are not eligible for the customer-facing default branch.
    branch.isDefault = false;
    return res.status(201).json({ success: true, branch, message: 'Branch created successfully.' });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: 'BRANCH_CODE_EXISTS', message: 'This branch code is already used by this pharmacy.' });
    return res.status(400).json({ success: false, code: 'BRANCH_CREATE_FAILED', message: error.message || 'Branch could not be created.' });
  }
});

router.patch('/:branchId', async (req, res) => {
  try {
    const scope = await resolveScope(req, res, { requireAdmin: true });
    if (!scope) return;
    const branch = await TenantBranch.findOne({ _id: clean(req.params.branchId), tenantId: scope.tenantId }).lean();
    if (!branch) return res.status(404).json({ success: false, code: 'BRANCH_NOT_FOUND', message: 'Branch not found for this pharmacy.' });
    if (branch.isTenantLocation) return res.status(409).json({ success: false, code: 'TENANT_LOCATION_MANAGED_BY_PROFILE', message: 'Edit the tenant profile to change this main branch location.' });
    const data = normalizeBranchPayload({ ...branch, ...req.body, geolocation: { ...(branch.geolocation || {}), ...(req.body?.geolocation || {}) }, address: { ...branch.address, ...req.body?.address }, operatingHours: { ...branch.operatingHours, ...req.body?.operatingHours } });
    const invalid = validateBranch(data);
    if (invalid) return res.status(400).json({ success: false, code: 'INVALID_BRANCH', message: invalid });
    const duplicate = await TenantBranch.findOne({ tenantId: scope.tenantId, code: data.code, _id: { $ne: branch._id } }).lean();
    if (duplicate) return res.status(409).json({ success: false, code: 'BRANCH_CODE_EXISTS', message: 'This branch code is already used by this pharmacy.' });
    const updated = await tenantService.updateBranch(branch._id, data, { userId: req.user?.sub });
    if (req.body?.isDefault === true) {
      await TenantBranch.updateMany({ tenantId: scope.tenantId }, { $set: { isDefault: false } });
      await TenantBranch.updateOne({ _id: branch._id, tenantId: scope.tenantId, status: 'ACTIVE' }, { $set: { isDefault: true } });
      updated.isDefault = true;
    }
    return res.json({ success: true, branch: updated, message: 'Branch updated successfully.' });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: 'BRANCH_CODE_EXISTS', message: 'This branch code is already used by this pharmacy.' });
    return res.status(400).json({ success: false, code: 'BRANCH_UPDATE_FAILED', message: error.message || 'Branch could not be updated.' });
  }
});

router.patch('/:branchId/status', async (req, res) => {
  try {
    const scope = await resolveScope(req, res, { requireAdmin: true });
    if (!scope) return;
    const status = clean(req.body?.status).toUpperCase();
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) return res.status(400).json({ success: false, code: 'INVALID_BRANCH_STATUS', message: 'Choose ACTIVE, INACTIVE or SUSPENDED.' });
    const branch = await TenantBranch.findOne({ _id: clean(req.params.branchId), tenantId: scope.tenantId }).lean();
    if (!branch) return res.status(404).json({ success: false, code: 'BRANCH_NOT_FOUND', message: 'Branch not found for this pharmacy.' });
    if (branch.status === 'PENDING' && status === 'ACTIVE') {
      const activated = await tenantService.activateBranch(branch._id, scope.tenantId, { userId: req.user?.sub });
      const hasDefault = await TenantBranch.exists({ tenantId: scope.tenantId, status: 'ACTIVE', isDefault: true });
      if (!hasDefault) {
        await TenantBranch.updateOne({ _id: activated.id || activated._id, tenantId: scope.tenantId }, { $set: { isDefault: true } });
        activated.isDefault = true;
      }
      return res.json({ success: true, branch: activated, message: 'Branch reviewed and activated.' });
    }
    if (branch.isTenantLocation) return res.status(409).json({ success: false, code: 'TENANT_LOCATION_MANAGED_BY_PROFILE', message: 'Change the tenant branch setting in Tenant Profile instead of deactivating the tenant location.' });
    if (status !== 'ACTIVE' && branch.isDefault) {
      const replacement = await TenantBranch.findOne({ tenantId: scope.tenantId, status: 'ACTIVE', _id: { $ne: branch._id } }).sort({ createdAt: 1 }).lean();
      if (!replacement) return res.status(409).json({ success: false, code: 'LAST_ACTIVE_BRANCH', message: 'Add or activate another branch before deactivating the only active branch.' });
      await TenantBranch.updateOne({ _id: replacement._id, tenantId: scope.tenantId }, { $set: { isDefault: true } });
    }
    const updated = await TenantBranch.findOneAndUpdate({ _id: branch._id, tenantId: scope.tenantId }, { $set: { status, ...(status !== 'ACTIVE' ? { isDefault: false } : {}) } }, { new: true, runValidators: true }).lean();
    return res.json({ success: true, branch: { ...updated, id: String(updated._id) }, message: status === 'ACTIVE' ? 'Branch activated.' : 'Branch deactivated.' });
  } catch (error) {
    return res.status(400).json({ success: false, code: 'BRANCH_STATUS_UPDATE_FAILED', message: error.message || 'Branch status could not be updated.' });
  }
});

router.delete('/:branchId', async (req, res) => {
  try {
    const scope = await resolveScope(req, res, { requireAdmin: true });
    if (!scope) return;
    const branch = await TenantBranch.findOne({ _id: clean(req.params.branchId), tenantId: scope.tenantId }).lean();
    if (!branch) return res.status(404).json({ success: false, code: 'BRANCH_NOT_FOUND', message: 'Branch not found for this pharmacy.' });
    if (branch.isTenantLocation) return res.status(409).json({ success: false, code: 'TENANT_LOCATION_MANAGED_BY_PROFILE', message: 'Change the tenant branch setting in Tenant Profile instead of removing the tenant location.' });
    // Branches are never hard-deleted: historical orders, inventory, prescriptions and audit references must remain resolvable.
    if (branch.isDefault) {
      const replacement = await TenantBranch.findOne({ tenantId: scope.tenantId, status: 'ACTIVE', _id: { $ne: branch._id } }).sort({ createdAt: 1 }).lean();
      if (!replacement) return res.status(409).json({ success: false, code: 'LAST_ACTIVE_BRANCH', message: 'Add another active branch before removing the only active branch.' });
      await TenantBranch.updateOne({ _id: replacement._id, tenantId: scope.tenantId }, { $set: { isDefault: true } });
    }
    const updated = await TenantBranch.findOneAndUpdate({ _id: branch._id, tenantId: scope.tenantId }, { $set: { status: 'INACTIVE', isDefault: false, archivedAt: new Date(), archivedBy: clean(req.user?.sub) } }, { new: true }).lean();
    return res.json({ success: true, branch: { ...updated, id: String(updated._id) }, archived: true, message: 'Branch archived. Historical records are preserved.' });
  } catch (error) {
    return res.status(400).json({ success: false, code: 'BRANCH_ARCHIVE_FAILED', message: error.message || 'Branch could not be archived.' });
  }
});

export default router;
