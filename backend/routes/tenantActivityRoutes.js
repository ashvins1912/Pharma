import express from 'express';
import AuditEvent from '../models/AuditEvent.js';
import TenantMembership from '../models/TenantMembership.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateUser);

router.get('/', async (req, res) => {
  try {
    const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
    const platform = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    const tenantId = String((platform
      ? req.query.tenantId || req.get('x-tenant-id')
      : req.user?.tenantId || req.user?.app_metadata?.tenantId) || '').trim();
    if (!tenantId) return res.status(400).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'Select a pharmacy first.' });
    let branchId = '';
    if (!platform) {
      const membership = await TenantMembership.findOne({ userId: String(req.user?.sub || ''), tenantId, status: 'ACTIVE' }).lean();
      if (!membership || !['TENANT_OWNER', 'TENANT_ADMIN'].includes(String(membership.role).toUpperCase())) {
        return res.status(403).json({ success: false, code: 'AUDIT_ACCESS_DENIED', message: 'Tenant administrator access is required to view activity.' });
      }
      branchId = String(membership.branchId || '');
    }
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    const filter = { tenantId };
    if (branchId) filter.branchId = branchId;
    const events = await AuditEvent.find(filter).sort({ occurredAt: -1, _id: -1 }).limit(limit).lean();
    return res.json({ success: true, events });
  } catch (error) {
    return res.status(503).json({ success: false, code: 'AUDIT_HISTORY_UNAVAILABLE', message: 'Tenant activity history is temporarily unavailable.' });
  }
});

export default router;
