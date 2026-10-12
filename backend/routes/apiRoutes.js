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

router.get('/vendor/profile', async (req, res) => {
    try {
        const tenantId = req.headers['x-tenant-id'] || '65a1234567890abcdef12345';
        res.json({
            status: 'success',
            tenant: {
                _id: tenantId,
                shopName: 'City Health Pharmacy & Wellness',
                address: { street: '123 Main Street', city: 'San Francisco', state: 'CA', zipCode: '94105' },
                geoLocation: { type: 'Point', coordinates: [-122.4194, 37.7749] },
                shopPhotoUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
                ownerDetails: { name: 'Ashvin Singh', email: 'ashvinsingh25@gmail.com', phone: '+19876543210' }
            },
            personnel: [
                { _id: 'user-1', name: 'Ashvin Singh', email: 'ashvinsingh25@gmail.com', role: 'OWNER' },
                { _id: 'user-2', name: 'Jane Doe', email: 'jane.admin@pharmacy.com', role: 'TENANT_ADMIN' },
                { _id: 'user-3', name: 'Bob Smith', email: 'bob.manager@pharmacy.com', role: 'MANAGER' }
            ]
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/tenant/branches', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const branches = [
            { id: 'branch-1', name: 'Downtown Flagship Dispensary', status: 'ACTIVE', location: '123 Main Street, San Francisco, CA', serviceRadiusKm: 12, minimumOrderValue: 150 },
            { id: 'branch-2', name: 'Northside Express Hub', status: 'ACTIVE', location: '456 Health Ave, San Francisco, CA', serviceRadiusKm: 15, minimumOrderValue: 200 },
            { id: 'branch-3', name: 'Westend Wellness Depot', status: 'MAINTENANCE', location: '789 Care Blvd, San Francisco, CA', serviceRadiusKm: 10, minimumOrderValue: 100 }
        ];
        res.json({
            status: 'success',
            branches,
            pagination: { page, limit, total: branches.length, totalPages: 1 }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/tenants/nearby', async (req, res) => {
    try {
        res.json({
            status: 'success',
            tenants: [
                {
                    _id: '65a1234567890abcdef12345',
                    shopName: 'City Health Pharmacy & Wellness',
                    address: { street: '123 Main Street', city: 'San Francisco', state: 'CA', zipCode: '94105' },
                    geoLocation: { type: 'Point', coordinates: [-122.4194, 37.7749] },
                    shopPhotoUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
                    distanceKm: 1.2
                },
                {
                    _id: '65b234567890abcdef67890',
                    shopName: 'MetroCare Express Pharmacy',
                    address: { street: '456 Market Street', city: 'San Francisco', state: 'CA', zipCode: '94104' },
                    geoLocation: { type: 'Point', coordinates: [-122.4000, 37.7800] },
                    shopPhotoUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=500&q=80',
                    distanceKm: 2.5
                }
            ]
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
