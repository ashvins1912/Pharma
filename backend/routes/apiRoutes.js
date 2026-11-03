import express from 'express';
import authRoutes from './authRoutes.js';
import couponRoutes from './couponRoutes.js';
import surplusSavingsRoutes from './surplusSavingsRoutes.js';
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
import { authenticateUser } from '../middleware/auth.js';
import TenantMembership from '../models/TenantMembership.js';
import tenantService from '../services/tenant-service/TenantService.js';
import UserProfile from '../models/UserProfile.js';
import riderRoutes from '../modules/delivery/routes/riderRoutes.js';
import assignmentRoutes from '../modules/delivery/routes/assignmentRoutes.js';
import { GoogleGenAI } from '@google/genai';
import { cacheService } from '../services/cache/CacheService.js';

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
router.use('/surplus-savings', surplusSavingsRoutes);
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

router.get('/vendor/profile', authenticateUser, async (req, res) => {
    try {
        const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
        const isPlatformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        const tenantId = String(isPlatformAdmin
            ? (req.get('x-tenant-id') || req.query.tenantId || '')
            : (req.user?.app_metadata?.tenantId || req.user?.tenantId || '')
        ).trim();
        if (!tenantId) return res.status(403).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'A pharmacy tenant context is required to view this profile.' });

        if (!isPlatformAdmin) {
            const membership = await TenantMembership.findOne({
                userId: String(req.user?.sub || req.user?.id || ''),
                tenantId,
                status: 'ACTIVE'
            }).lean();
            if (!membership) return res.status(403).json({ success: false, code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active membership for this pharmacy is required.' });
        }

        const [tenant, vendor, memberships] = await Promise.all([
            Tenant.findOne({ _id: tenantId }).lean(),
            Vendor.findOne({ tenantId }).lean(),
            TenantMembership.find({ tenantId, status: 'ACTIVE' }).select('userId role branchId').lean()
        ]);
        if (!tenant) return res.status(404).json({ success: false, code: 'TENANT_PROFILE_NOT_FOUND', message: 'The authenticated pharmacy profile has not been created yet.' });

        const userIds = [...new Set(memberships.map(item => String(item.userId)))];
        const profiles = userIds.length ? await UserProfile.find({
            $or: [
                { supabase_user_id: { $in: userIds } },
                { supabaseId: { $in: userIds } },
                { userId: { $in: userIds } }
            ]
        }).select('supabase_user_id supabaseId userId name email').lean() : [];
        const profileById = new Map();
        for (const profile of profiles) {
            for (const id of [profile.supabase_user_id, profile.supabaseId, profile.userId].filter(Boolean)) profileById.set(String(id), profile);
        }
        const personnel = memberships.map(member => {
            const profile = profileById.get(String(member.userId)) || {};
            return {
                _id: String(member.userId),
                name: profile.name || '',
                email: profile.email || '',
                role: member.role,
                branchId: member.branchId || null
            };
        });

        return res.json({
            status: 'success',
            profileConfigured: Boolean(vendor),
            tenant: {
                _id: String(tenant._id),
                shopName: tenant.name || vendor?.companyName || '',
                legalName: vendor?.legalName || '',
                licenseNumber: vendor?.licenseNumber || '',
                gstNumber: vendor?.gstNumber || '',
                address: {
                    street: vendor?.address?.street || '',
                    city: vendor?.address?.city || '',
                    state: vendor?.address?.state || '',
                    zipCode: vendor?.address?.pincode || ''
                },
                geoLocation: vendor?.latitude != null && vendor?.longitude != null ? {
                    type: 'Point',
                    coordinates: [Number(vendor.longitude), Number(vendor.latitude)]
                } : null,
                shopPhotoUrl: vendor?.shopPhotoUrl || null,
                ownerDetails: {
                    name: vendor?.name || req.user?.name || '',
                    email: vendor?.email || req.user?.email || '',
                    phone: vendor?.mobile || ''
                }
            },
            personnel
        });
    } catch (err) {
        console.error('[TenantProfile] Scoped profile lookup failed:', { requestId: req.requestId || null, code: err.code || err.name });
        return res.status(503).json({ success: false, code: 'TENANT_PROFILE_UNAVAILABLE', message: 'Pharmacy profile is temporarily unavailable.' });
    }
});

const resolveTenantBranchScope = async (req) => {
    const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
    const isPlatformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    const tenantId = String(isPlatformAdmin
        ? (req.get('x-tenant-id') || req.query.tenantId || req.body?.tenantId || '')
        : (req.user?.app_metadata?.tenantId || req.user?.tenantId || '')
    ).trim();
    if (!tenantId) return { error: [403, 'TENANT_CONTEXT_REQUIRED', 'An authenticated tenant context is required.'] };
    let membership = null;
    if (!isPlatformAdmin) {
        membership = await TenantMembership.findOne({ userId: String(req.user?.sub || req.user?.id || ''), tenantId, status: 'ACTIVE' }).lean();
        if (!membership) return { error: [403, 'TENANT_MEMBERSHIP_REQUIRED', 'An active membership for this pharmacy is required.'] };
    }
    const memberRole = String(membership?.role || role).toUpperCase();
    return { tenantId, membership, isPlatformAdmin, canManage: isPlatformAdmin || ['TENANT_OWNER', 'TENANT_ADMIN'].includes(memberRole) };
};

router.get('/tenant/branches', authenticateUser, async (req, res) => {
    try {
        const scope = await resolveTenantBranchScope(req);
        if (scope.error) return res.status(scope.error[0]).json({ success: false, code: scope.error[1], message: scope.error[2] });
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
        const includePending = req.query.includePending === 'true' && scope.canManage;
        const list = await tenantService.getBranches(scope.tenantId, includePending ? {} : { status: 'ACTIVE' });
        const scoped = scope.isPlatformAdmin || !scope.membership?.branchId
            ? list
            : list.filter(branch => String(branch.id || branch._id) === String(scope.membership.branchId));
        const total = scoped.length;
        return res.json({ status: 'success', branches: scoped.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) {
        console.error('[TenantBranches] Scoped branch lookup failed:', { requestId: req.requestId || null, code: err.code || err.name });
        return res.status(503).json({ success: false, code: 'TENANT_BRANCH_REGISTRY_UNAVAILABLE', message: 'Pharmacy branches are temporarily unavailable.' });
    }
});

router.post('/tenant/branches', authenticateUser, async (req, res) => {
    try {
        const scope = await resolveTenantBranchScope(req);
        if (scope.error) return res.status(scope.error[0]).json({ success: false, code: scope.error[1], message: scope.error[2] });
        if (!scope.canManage) return res.status(403).json({ success: false, code: 'BRANCH_MANAGEMENT_FORBIDDEN', message: 'Only a pharmacy owner or administrator can create branches.' });
        const branch = await tenantService.createBranch(scope.tenantId, req.body || {}, req.context || req.user);
        return res.status(201).json({ success: true, data: branch });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, code: err.code || 'BRANCH_CREATE_FAILED', message: err.message || 'Branch could not be created.' });
    }
});

router.post('/tenant/branches/:branchId/activate', authenticateUser, async (req, res) => {
    try {
        const scope = await resolveTenantBranchScope(req);
        if (scope.error) return res.status(scope.error[0]).json({ success: false, code: scope.error[1], message: scope.error[2] });
        if (!scope.canManage) return res.status(403).json({ success: false, code: 'BRANCH_MANAGEMENT_FORBIDDEN', message: 'Only a pharmacy owner or administrator can activate branches.' });
        const branch = await tenantService.activateBranch(req.params.branchId, scope.tenantId, req.context || req.user);
        await cacheService.del('cache:tenants:branches:all');
        await cacheService.del(`cache:tenant:${scope.tenantId}:branches:v2`);
        return res.json({ success: true, data: branch });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, code: err.code || 'BRANCH_ACTIVATION_FAILED', message: err.message || 'Branch could not be activated.' });
    }
});

import Tenant from '../models/Tenant.js';
import Vendor from '../models/Vendor.js';

const optionalTenantAuthentication = (req, res, next) => {
    const hasCredential = Boolean(
        req.get('x-gateway-trusted-authorization')
        || req.get('authorization')?.startsWith('Bearer ')
        || req.cookies?.access_token
        || req.get('cookie')?.match(/(?:^|;\\s*)access_token=/)
    );
    return hasCredential ? authenticateUser(req, res, next) : next();
};

router.get('/tenants/nearby', optionalTenantAuthentication, async (req, res) => {
    try {
        const hasLat = req.query.lat !== undefined;
        const hasLng = req.query.lng !== undefined;
        const userLat = hasLat ? Number(req.query.lat) : null;
        const userLng = hasLng ? Number(req.query.lng) : null;
        const requestedCity = String(req.query.city || '').trim().toLowerCase();
        const requestedPincode = String(req.query.pincode || '').replace(/\\D/g, '').slice(0, 10);
        if (hasLat !== hasLng || (hasLat && (!Number.isFinite(userLat) || userLat < -90 || userLat > 90
            || !Number.isFinite(userLng) || userLng < -180 || userLng > 180))) {
            return res.status(400).json({ message: 'Provide valid latitude and longitude coordinates.' });
        }

        // A signed tenant session is never allowed to discover/select a different pharmacy.
        const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
        const isPlatformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        const authenticatedTenantId = String(req.user?.app_metadata?.tenantId || req.user?.tenantId || '').trim();
        let tenantFilter = { status: 'ACTIVE' };
        if (req.user && !isPlatformAdmin && authenticatedTenantId) {
            const membership = await TenantMembership.findOne({
                userId: String(req.user.sub || req.user.id || ''),
                tenantId: authenticatedTenantId,
                status: 'ACTIVE'
            }).lean();
            if (!membership) return res.status(403).json({ success: false, code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'Your active pharmacy membership could not be verified.' });
            tenantFilter = { _id: authenticatedTenantId, status: 'ACTIVE' };
        } else if (req.user && !isPlatformAdmin && ['TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACY', 'PHARMACIST', 'PHARMACY_STAFF'].includes(role)) {
            return res.status(403).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'Your pharmacy session is missing its tenant identity.' });
        }

        const dbTenants = await Tenant.find(tenantFilter).lean();
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
            const vendorPincode = String(vendor.address?.pincode || '').replace(/\\D/g, '');
            const vendorCity = String(vendor.address?.city || '').trim().toLowerCase();
            const locationMatch = requestedPincode && vendorPincode === requestedPincode
                ? 'PINCODE'
                : requestedCity && vendorCity === requestedCity ? 'CITY' : null;
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
                distanceKm: distance == null ? null : Number(distance.toFixed(1)),
                locationMatch
            }];
        });
        if (userLat != null) {
            tenants.sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));
        } else if (requestedPincode || requestedCity) {
            tenants.sort((a, b) => {
                const score = item => item.locationMatch === 'PINCODE' ? 0 : item.locationMatch === 'CITY' ? 1 : 2;
                return score(a) - score(b);
            });
        }
        return res.json({ status: 'success', tenants, scope: req.user && !isPlatformAdmin && authenticatedTenantId ? 'TENANT' : 'DISCOVERY' });
    } catch (err) {
        console.error('[TenantDiscovery] Nearby pharmacy lookup failed:', { requestId: req.requestId || null, code: err.code || err.name });
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
