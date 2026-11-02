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
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
        headers: {
            'User-Agent': 'aistudio-build'
        }
    }
});

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
import { pharmacyLocationService } from '../services/PharmacyLocationService.js';

router.get('/tenants/nearby', async (req, res) => {
    try {
        const hasLat = req.query.lat !== undefined;
        const hasLng = req.query.lng !== undefined;
        const userLat = hasLat ? Number(req.query.lat) : null;
        const userLng = hasLng ? Number(req.query.lng) : null;
        if (hasLat !== hasLng || (hasLat && (!Number.isFinite(userLat) || userLat < -90 || userLat > 90
            || !Number.isFinite(userLng) || userLng < -180 || userLng > 180))) {
            return res.status(400).json({ message: 'Provide valid latitude and longitude coordinates.' });
        }
        const dbTenants = await Tenant.find({ status: 'ACTIVE' }).lean();
        const tenantIds = dbTenants.map(tenant => String(tenant._id));
        const vendors = tenantIds.length
            ? await Vendor.find({ status: 'ACTIVE', tenantId: { $in: tenantIds } }).lean()
            : [];
        const vendorByTenant = new Map(vendors.map(vendor => [String(vendor.tenantId), vendor]));
        const radians = value => value * Math.PI / 180;
        const distanceKm = (lat1, lng1, lat2, lng2) => {
            const dLat = radians(lat2 - lat1);
            const dLng = radians(lng2 - lng1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1))
                * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
            return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        let tenants = dbTenants.flatMap(tenant => {
            const vendor = vendorByTenant.get(String(tenant._id));
            if (!vendor) return [];
            const lat = Number(vendor.latitude ?? vendor.geoLocation?.coordinates?.[1]);
            const lng = Number(vendor.longitude ?? vendor.geoLocation?.coordinates?.[0]);
            const hasCoordinates = Number.isFinite(lat) && lat >= -90 && lat <= 90
                && Number.isFinite(lng) && lng >= -180 && lng <= 180
                && (vendor.latitude != null || vendor.longitude != null || vendor.geoLocation?.coordinates?.length === 2);
            const distance = userLat != null && hasCoordinates ? distanceKm(userLat, userLng, lat, lng) : null;
            if (userLat != null && (!hasCoordinates || distance > 100)) return [];
            return [{
                _id: tenant._id,
                shopName: tenant.name || vendor.companyName,
                address: {
                    street: vendor.address?.street || '',
                    city: vendor.address?.city || '',
                    state: vendor.address?.state || '',
                    zipCode: vendor.address?.pincode || ''
                },
                geoLocation: hasCoordinates ? { type: 'Point', coordinates: [lng, lat] } : null,
                shopPhotoUrl: vendor.shopPhotoUrl || null,
                distanceKm: distance == null ? null : Number(distance.toFixed(1))
            }];
        });
        if (userLat != null) tenants.sort((a, b) => a.distanceKm - b.distanceKm);
        return res.json({ status: 'success', tenants });
    } catch (err) {
        console.error('[TenantDiscovery] Nearby pharmacy lookup failed:', err);
        return res.status(503).json({ message: 'Nearby pharmacy discovery is temporarily unavailable.' });
    }
});

router.post('/med-search-grounding', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || !query.trim()) {
            return res.status(400).json({ error: 'Search query is required.' });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `Provide real-time medical information, clinical usage, indications, dosage guidance, warnings, and local pharmacy availability insights for the medicine or query: "${query.trim()}". Keep it concise, professional, and clear for a pharmacy customer or dispenser.`,
            config: {
                tools: [{ googleSearch: {} }]
            }
        });

        const text = response.text || 'No medical summary found.';
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const sources = chunks
            .map(c => c.web ? { title: c.web.title, uri: c.web.uri } : null)
            .filter(Boolean);

        res.json({
            status: 'success',
            query: query.trim(),
            summary: text,
            sources
        });
    } catch (error) {
        console.error('Search grounding error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch grounded medical search results.' });
    }
});

import multer from 'multer';
import { imageOptimizationService } from '../services/ImageOptimizationService.js';

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/upload/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded.' });
        }
        const result = await imageOptimizationService.processAndStore(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
        );
        res.json({
            status: 'success',
            data: result
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
