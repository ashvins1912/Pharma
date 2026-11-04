import express from 'express';
import Tenant from '../../models/Tenant.js';
import Vendor from '../../models/Vendor.js';
import TenantMembership from '../../models/TenantMembership.js';
import { authenticateUser, requirePlatformSuperAdmin } from '../../middleware/auth.js';

const router = express.Router();
const platformRoles = new Set(['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'ADMIN', 'admin']);
const getRole = req => String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
const isPlatformAdmin = req => platformRoles.has(getRole(req));

async function resolveTenant(req, res) {
  const tenantId = isPlatformAdmin(req)
    ? String(req.get('x-tenant-id') || req.query.tenantId || req.body?.tenantId || '').trim()
    : String(req.user?.tenantId || req.user?.app_metadata?.tenantId || '').trim();
  if (!tenantId) {
    res.status(403).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'Select a pharmacy tenant.' });
    return null;
  }
  if (!isPlatformAdmin(req)) {
    const membership = await TenantMembership.findOne({
      userId: String(req.user?.sub || req.user?.id || ''),
      tenantId,
      status: 'ACTIVE'
    }).lean();
    if (!membership) {
      res.status(403).json({ success: false, code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'Active membership for this pharmacy is required.' });
      return null;
    }
  }
  const tenant = await Tenant.findOne({ _id: tenantId, status: { $ne: 'DISABLED' } });
  if (!tenant) {
    res.status(404).json({ success: false, code: 'TENANT_PROFILE_NOT_FOUND', message: 'Pharmacy profile was not found.' });
    return null;
  }
  return tenant;
}

router.get('/profile/edit-policy', authenticateUser, async (req, res) => {
  try {
    const tenant = await resolveTenant(req, res);
    if (!tenant) return;
    res.json({
      success: true,
      data: {
        pharmacyCanEdit: tenant.settings?.pharmacyProfileEditingEnabled === true,
        controlledBy: 'SUPER_ADMIN',
        updatedAt: tenant.settings?.profileEditingPolicyUpdatedAt || null
      }
    });
  } catch (error) {
    console.error('[TenantProfilePolicy] Read failed:', error);
    res.status(503).json({ success: false, code: 'PROFILE_POLICY_UNAVAILABLE', message: 'Profile edit policy is temporarily unavailable.' });
  }
});

router.patch('/profile/edit-policy', authenticateUser, requirePlatformSuperAdmin, async (req, res) => {
  try {
    const tenant = await resolveTenant(req, res);
    if (!tenant) return;
    if (typeof req.body?.pharmacyCanEdit !== 'boolean') {
      return res.status(400).json({ success: false, code: 'INVALID_PROFILE_POLICY', message: 'pharmacyCanEdit must be true or false.' });
    }
    tenant.set('settings.pharmacyProfileEditingEnabled', req.body.pharmacyCanEdit);
    tenant.set('settings.profileEditingPolicyUpdatedAt', new Date());
    tenant.set('settings.profileEditingPolicyUpdatedBy', String(req.user?.sub || req.user?.id || ''));
    tenant.profileAudit.push({ action: 'PROFILE_EDIT_PERMISSION_CHANGED', changedFields: ['pharmacyProfileEditingEnabled'], actorId: String(req.user?.sub || req.user?.id || ''), actorRole: getRole(req), at: new Date() });
    if (tenant.profileAudit.length > 100) tenant.profileAudit = tenant.profileAudit.slice(-100);
    await tenant.save();
    return res.json({ success: true, data: { pharmacyCanEdit: req.body.pharmacyCanEdit }, message: 'Pharmacy profile edit permission updated.' });
  } catch (error) {
    console.error('[TenantProfilePolicy] Update failed:', error);
    res.status(503).json({ success: false, code: 'PROFILE_POLICY_UPDATE_FAILED', message: 'Could not update pharmacy profile permissions.' });
  }
});

router.patch('/profile', authenticateUser, async (req, res) => {
  try {
    const tenant = await resolveTenant(req, res);
    if (!tenant) return;
    const platformAdmin = isPlatformAdmin(req);
    if (!platformAdmin && tenant.settings?.pharmacyProfileEditingEnabled !== true) {
      return res.status(403).json({
        success: false,
        code: 'PHARMACY_PROFILE_EDIT_DISABLED',
        message: 'Your Super Admin has disabled pharmacy profile editing. Contact platform support to request a change.'
      });
    }

    const body = req.body || {};
    const shopName = typeof body.shopName === 'string' ? body.shopName.trim() : undefined;
    const legalName = typeof body.legalName === 'string' ? body.legalName.trim() : undefined;
    const licenseNumber = typeof body.licenseNumber === 'string' ? body.licenseNumber.trim().toUpperCase() : undefined;
    const gstNumber = typeof body.gstNumber === 'string' ? body.gstNumber.trim().toUpperCase() : undefined;
    const address = body.address && typeof body.address === 'object' ? body.address : null;
    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase() : undefined;
    const contactPhone = typeof body.contactPhone === 'string' ? body.contactPhone.trim() : undefined;
    if (contactEmail !== undefined && contactEmail && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(contactEmail)) {
      return res.status(400).json({ success: false, code: 'INVALID_CONTACT_EMAIL', message: 'Enter a valid pharmacy contact email.' });
    }
    if (shopName !== undefined && !shopName) {
      return res.status(400).json({ success: false, code: 'INVALID_PHARMACY_NAME', message: 'Pharmacy name cannot be empty.' });
    }
    const changedFields = [];
    if (shopName !== undefined) { tenant.name = shopName; changedFields.push('shopName'); }
    if (legalName !== undefined) { tenant.legalName = legalName; changedFields.push('legalName'); }
    if (licenseNumber !== undefined) { tenant.drugLicenseNumber = licenseNumber; changedFields.push('licenseNumber'); }
    if (gstNumber !== undefined) { tenant.gstNumber = gstNumber; changedFields.push('gstNumber'); }
    if (contactEmail !== undefined) { tenant.contactEmail = contactEmail; changedFields.push('contactEmail'); }
    if (contactPhone !== undefined) { tenant.contactPhone = contactPhone; changedFields.push('contactPhone'); }
    if (address) {
      changedFields.push('address');
      tenant.address = {
        street: String(address.street ?? tenant.address?.street ?? '').trim(),
        city: String(address.city ?? tenant.address?.city ?? '').trim(),
        state: String(address.state ?? tenant.address?.state ?? '').trim(),
        pincode: String(address.zipCode ?? address.pincode ?? tenant.address?.pincode ?? '').trim()
      };
    }
    tenant.profileAudit.push({ action: 'PHARMACY_PROFILE_UPDATED', changedFields, actorId: String(req.user?.sub || req.user?.id || ''), actorRole: getRole(req), at: new Date() });
    if (tenant.profileAudit.length > 100) tenant.profileAudit = tenant.profileAudit.slice(-100);
    await tenant.save();

    const vendor = await Vendor.findOne({ tenantId: String(tenant._id) }).sort({ updatedAt: -1 });
    if (vendor) {
      if (shopName !== undefined) vendor.companyName = shopName;
      if (licenseNumber !== undefined) vendor.drugLicenseNumber = licenseNumber;
      if (gstNumber !== undefined) vendor.gstNumber = gstNumber;
      if (contactEmail !== undefined) vendor.email = contactEmail;
      if (contactPhone !== undefined) vendor.mobile = contactPhone;
      if (address) vendor.address = { street: tenant.address.street || '', city: tenant.address.city || '', state: tenant.address.state || '', pincode: tenant.address.pincode || '' };
      await vendor.save();
    }
    return res.json({
      success: true,
      data: {
        tenant: {
          id: String(tenant._id), shopName: tenant.name || '', legalName: tenant.legalName || '',
          licenseNumber: tenant.drugLicenseNumber || '', gstNumber: tenant.gstNumber || '',
          ownerDetails: { name: '', email: tenant.contactEmail || '', phone: tenant.contactPhone || '' },
          address: { street: tenant.address?.street || '', city: tenant.address?.city || '', state: tenant.address?.state || '', zipCode: tenant.address?.pincode || '' }
        }
      },
      message: 'Pharmacy details updated successfully.'
    });
  } catch (error) {
    console.error('[TenantProfile] Update failed:', error);
    res.status(503).json({ success: false, code: 'TENANT_PROFILE_UPDATE_FAILED', message: 'Pharmacy details could not be updated.' });
  }
});

export default router;
