import express from 'express';
import multer from 'multer';
import { authenticateUser } from '../../../middleware/auth.js';
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

// All rider operations are protected for administrators
const TENANT_RIDER_ROLES = new Set(['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'ORDER_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN']);
const PLATFORM_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN']);
router.use(authenticateUser, (req, res, next) => {
    const role = String(req.user?.role || req.user?.app_metadata?.role || '').toUpperCase();
    const tenantId = req.user?.tenantId || req.user?.app_metadata?.tenantId;
    if (PLATFORM_ROLES.has(role)) return next();
    if (TENANT_RIDER_ROLES.has(role) && tenantId) return next();
    return res.status(403).json({ code: 'RIDER_MANAGEMENT_FORBIDDEN', message: 'Tenant rider management permission and an active tenant context are required.' });
});

// GET /api/admin/riders - List all riders
router.get('/', listRiders);

// POST /api/admin/riders/onboard - Onboard new rider with photo upload
router.post('/onboard', uploadPhoto.single('photo'), registerRider);

// Soft-disable/restore a rider; rider records and remarks remain in the database.
router.patch('/:riderId/enabled', setRiderEnabled);

// PATCH /api/admin/riders/:riderId/status - Update rider status (Available, Busy, Off-duty)
router.patch('/:riderId/status', updateRiderStatus);

// PATCH /api/admin/riders/:riderId/location - Update rider GPS coordinates
router.patch('/:riderId/location', updateRiderLocation);

export default router;
