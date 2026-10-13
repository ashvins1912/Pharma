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

import Tenant from '../models/Tenant.js';
import Vendor from '../models/Vendor.js';
import { cacheService } from '../services/cache/CacheService.js';

router.get('/tenants/nearby', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const cacheKey = 'cache:api:tenants:nearby:dynamic';
        let tenants = await cacheService.get(cacheKey);

        if (!tenants) {
            const dbTenants = await Tenant.find({ status: 'ACTIVE' }).lean();
            const vendors = await Vendor.find({ status: 'ACTIVE' }).lean();

            tenants = dbTenants.map((t, idx) => {
                const vendor = vendors.find(v => v.tenantId === t._id) || vendors[idx] || {};
                return {
                    _id: t._id,
                    shopName: t.name || vendor.companyName || 'Pharmacy Dispensary',
                    address: {
                        street: vendor.address?.street || 'Central Medical Hub',
                        city: vendor.address?.city || 'San Francisco',
                        state: vendor.address?.state || 'CA',
                        zipCode: vendor.address?.pincode || '94105'
                    },
                    geoLocation: {
                        type: 'Point',
                        coordinates: [
                            Number(vendor.longitude || -122.4194 + (idx * 0.01)),
                            Number(vendor.latitude || 37.7749 + (idx * 0.01))
                        ]
                    },
                    shopPhotoUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
                    distanceKm: null
                };
            });

            if (tenants.length === 0) {
                tenants = [
                    {
                        _id: 'tenant-default-1',
                        shopName: 'City Health Pharmacy & Wellness',
                        address: { street: '123 Main Street', city: 'San Francisco', state: 'CA', zipCode: '94105' },
                        geoLocation: { type: 'Point', coordinates: [-122.4194, 37.7749] },
                        shopPhotoUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80'
                    }
                ];
            }

            // Cache put with 15-minute TTL (900 seconds)
            await cacheService.set(cacheKey, tenants, 900);
        }

        const userLat = lat != null ? Number(lat) : null;
        const userLng = lng != null ? Number(lng) : null;

        const results = tenants.map(t => {
            let distanceKm = 1.2;
            if (userLat != null && userLng != null && t.geoLocation?.coordinates) {
                const [tLng, tLat] = t.geoLocation.coordinates;
                const R = 6371;
                const dLat = (tLat - userLat) * (Math.PI / 180);
                const dLon = (tLng - userLng) * (Math.PI / 180);
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                          Math.cos(userLat * (Math.PI / 180)) * Math.cos(tLat * (Math.PI / 180)) *
                          Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                distanceKm = Number((R * c).toFixed(1));
            }
            return { ...t, distanceKm };
        });

        if (userLat != null && userLng != null) {
            results.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
        }

        res.json({
            status: 'success',
            tenants: results
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
