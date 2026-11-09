import express from 'express';
import authRoutes from './authRoutes.js';
import couponRoutes from './couponRoutes.js';
import medicineRequestRoutes from './medicineRequestRoutes.js';
import medicineRoutes from './medicineRoutes.js';
import orderRoutes from './orderRoutes.js';
import { legacyProfileRoutes } from './profileRoutes.js';
import profileRoutes from './profileRoutes.js';
import proposalRoutes from './proposalRoutes.js';
import riderProfileRoutes from './riderProfileRoutes.js';
import testRoutes from './testRoutes.js';
import whatsappRoutes from './whatsappRoutes.js';
import versionedOrderRoutes from './versionedOrderRoutes.js';
import adminRoutes from './adminRoutes.js';
import riderRoutes from '../modules/delivery/routes/riderRoutes.js';
import assignmentRoutes from '../modules/delivery/routes/assignmentRoutes.js';
import multer from 'multer';
import { authenticateUser, requirePermission } from '../middleware/auth.js';
import { imageOptimizationService } from '../services/ImageOptimizationService.js';

const router = express.Router();

const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

router.post('/upload/image', authenticateUser, requirePermission('inventory.write'), imageUpload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
        const result = await imageOptimizationService.processAndStore(
            req.file.buffer, req.file.originalname, req.file.mimetype
        );
        return res.json({ status: 'success', data: result });
    } catch (error) {
        console.error('[ImageUpload] Image storage provider failed:', error);
        return res.status(503).json({ error: 'Image upload is temporarily unavailable.' });
    }
});

router.use('/auth', authRoutes);
router.use('/medicines', medicineRoutes);
router.use('/orders', orderRoutes);
router.use('/riders', riderProfileRoutes);
router.use('/profile', profileRoutes);
router.use('/user', legacyProfileRoutes);
router.use('/coupons', couponRoutes);
router.use('/admin/whatsapp', whatsappRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/riders', riderRoutes);
router.use('/admin/assignment', assignmentRoutes);
router.use('/medicine-requests', medicineRequestRoutes);
router.use('/admin/medicine-requests', (req, _res, next) => {
    req.medicineRequestAudience = 'staff';
    return next();
}, medicineRequestRoutes);
router.use('/proposals', proposalRoutes);
router.use('/v1/orders', versionedOrderRoutes);
router.use('/test', testRoutes);

export default router;
