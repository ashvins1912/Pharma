import express from 'express';
import multer from 'multer';
import { authenticateUser, isAdmin } from '../../../middleware/auth.js';
import {
    registerRider,
    listRiders,
    updateRiderStatus,
    updateRiderLocation
} from '../controllers/riderController.js';

const router = express.Router();
const uploadPhoto = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// All rider operations are protected for administrators
router.use(authenticateUser, isAdmin);

// GET /api/admin/riders - List all riders
router.get('/', listRiders);

// POST /api/admin/riders/onboard - Onboard new rider with photo upload
router.post('/onboard', uploadPhoto.single('photo'), registerRider);

// PATCH /api/admin/riders/:riderId/status - Update rider status (Available, Busy, Off-duty)
router.patch('/:riderId/status', updateRiderStatus);

// PATCH /api/admin/riders/:riderId/location - Update rider GPS coordinates
router.patch('/:riderId/location', updateRiderLocation);

export default router;
