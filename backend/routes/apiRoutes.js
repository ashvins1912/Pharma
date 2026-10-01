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

const router = express.Router();

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
