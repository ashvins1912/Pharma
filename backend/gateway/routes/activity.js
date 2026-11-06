import express from 'express';
import { authenticateUser } from '../../middleware/auth.js';
import { queryActivity } from '../../middleware/activityAudit.js';
import TenantMembership from '../../models/TenantMembership.js';

const router = express.Router();
router.use(authenticateUser);

router.get('/', async (req, res) => {
  try {
    const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
    const platformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    const tenantId = String(
      (platformAdmin ? (req.query.tenantId || req.get('x-tenant-id')) : null)
      || req.context?.tenantId
      || req.user?.tenantId
      || req.user?.app_metadata?.tenantId
      || ''
    ).trim();
    if (!tenantId) return res.status(400).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'Select a pharmacy tenant to view its activity.' });

    let branchId = String(req.query.branchId || req.get('x-branch-id') || req.context?.branchId || '').trim();
    if (!platformAdmin) {
      const membership = await TenantMembership.findOne({
        userId: String(req.user?.sub || ''),
        tenantId,
        status: 'ACTIVE'
      }).lean();
      if (!membership) return res.status(403).json({ success: false, code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active pharmacy membership is required.' });
      if (membership.branchId) {
        if (branchId && branchId !== String(membership.branchId)) return res.status(403).json({ success: false, code: 'BRANCH_SCOPE_FORBIDDEN', message: 'You cannot view another branch activity.' });
        branchId = String(membership.branchId);
      }
    }
    const result = await queryActivity({ tenantId, branchId: branchId || undefined, page: req.query.page, limit: req.query.limit });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Activity feed retrieval failed:', error.message);
    return res.status(503).json({ success: false, code: 'ACTIVITY_FEED_UNAVAILABLE', message: 'Activity history is temporarily unavailable.' });
  }
});

export default router;
