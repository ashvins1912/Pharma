import express from 'express';
import multer from 'multer';
import { authenticateUser, requirePermission } from '../../../middleware/auth.js';
import { requireTenantScope } from '../../../middleware/authorization.js';
import {
    registerRider,
    listRiders,
    setRiderEnabled,
    updateRiderStatus,
    updateRiderLocation
} from '../controllers/riderController.js';

const router = express.Router();
const uploadPhoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Tenant/platform scope is resolved centrally; endpoint permissions remain explicit.
router.use(authenticateUser, requireTenantScope());

// GET /api/admin/riders - List all riders
router.get('/', requirePermission('delivery.read'), listRiders);

// POST /api/admin/riders/onboard - Onboard new rider with photo upload
router.post('/onboard', requirePermission('delivery.manage'), uploadPhoto.single('photo'), registerRider);

// Soft-disable/restore a rider; rider records and remarks remain in the database.
router.patch('/:riderId/enabled', requirePermission('delivery.manage'), setRiderEnabled);

// PATCH /api/admin/riders/:riderId/status - Update rider status (Available, Busy, Off-duty)
router.patch('/:riderId/status', requirePermission('delivery.manage'), updateRiderStatus);

// PATCH /api/admin/riders/:riderId/location - Update rider GPS coordinates
router.patch('/:riderId/location', requirePermission('delivery.manage'), updateRiderLocation);

export default router;
