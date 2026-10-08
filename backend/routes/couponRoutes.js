import express from 'express';
import mongoose from 'mongoose';
import Coupon from '../models/Coupon.js';
import Order from '../models/Order.js';
import UserProfile from '../models/UserProfile.js';
import { authenticateUser, requirePermission } from '../middleware/auth.js';
import { getIsConnected } from '../config/db.js';

const router = express.Router();
const TENANT_ROLES = new Set(['TENANT_OWNER','TENANT_ADMIN','PHARMACIST','PHARMACY_STAFF','ORDER_MANAGER','admin','SUPER_ADMIN','PLATFORM_SUPER_ADMIN']);
const getRole = req => req.user?.app_metadata?.role || req.user?.role || 'customer';
const getTenantId = req => req.user?.tenantId || req.user?.app_metadata?.tenantId || null;
const isPlatformRole = role => ['admin','SUPER_ADMIN','PLATFORM_SUPER_ADMIN'].includes(role);
const requireTenantPromotionAccess = (req, res, next) => { if (!TENANT_ROLES.has(getRole(req))) return res.status(403).json({ success: false, message: 'Tenant administrator privileges are required.' }); return next(); };
const usableCoupon = (coupon, orderTotal) => { if (!coupon || !coupon.isActive) return false; if (coupon.expiryDate && new Date(coupon.expiryDate) <= new Date()) return false; if (coupon.usageLimit != null && Number(coupon.usageCount || 0) >= Number(coupon.usageLimit)) return false; return orderTotal >= Number(coupon.minOrderAmount ?? coupon.minOrderValue ?? 0); };
const couponResult = (coupon, orderTotal) => { const type = coupon.discountType || 'percentage'; const value = Number(coupon.discountValue ?? coupon.discountPercentage ?? 0); const minimum = Number(coupon.minOrderAmount ?? coupon.minOrderValue ?? 0); const discountAmount = type === 'fixed' ? Math.min(value, orderTotal) : Math.round((orderTotal * value / 100 + Number.EPSILON) * 100) / 100; return { code: coupon.code, discountType: type, discountValue: value, discountPercentage: type === 'percentage' ? value : 0, minOrderAmount: minimum, expiryDate: coupon.expiryDate, promotionLabel: coupon.promotionLabel || 'Pharma discount for you', promotionType: coupon.promotionType || 'PUBLIC', autoApply: Boolean(coupon.autoApply), discountAmount, finalTotal: Math.max(0, orderTotal - discountAmount) }; };

router.get('/my-offer', authenticateUser, async (req, res) => {
    if (!getIsConnected() || mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Promotions are temporarily unavailable.' });
    try {
        const orderTotal = Number(req.query.orderTotal || 0);
        const tenantId = getTenantId(req);
        const filter = { customerId: req.user.sub, isActive: true, autoApply: true, ...(tenantId ? { tenantId } : {}) };
        const coupons = await Coupon.find(filter).sort({ createdAt: -1 }).lean();
        const eligible = coupons.filter(coupon => usableCoupon(coupon, orderTotal));
        if (!eligible.length) return res.json({ success: true, promotion: null });
        const best = eligible.map(coupon => couponResult(coupon, orderTotal)).sort((a,b) => b.discountAmount - a.discountAmount)[0];
        return res.json({ success: true, promotion: best });
    } catch (error) { console.error('Customer promotion lookup failed:', error); return res.status(500).json({ success: false, message: 'Could not load your pharmacy discount.' }); }
});

router.get('/admin/customers', authenticateUser, requirePermission('promotions.read'), requireTenantPromotionAccess, async (req, res) => {
    if (!getIsConnected() || mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Customer promotion data is temporarily unavailable.' });
    try {
        const tenantId = getTenantId(req); const search = String(req.query.search || '').trim(); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const profileFilter = { role: { $in: ['CUSTOMER','customer'] } }; if (tenantId && !isPlatformRole(getRole(req))) profileFilter.tenantId = tenantId;
        if (search) { profileFilter.$or = [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }, { normalizedEmail: { $regex: search, $options: 'i' } }, { mobile: { $regex: search, $options: 'i' } }, { userId: { $regex: search, $options: 'i' } }, { supabaseId: { $regex: search, $options: 'i' } }]; }
        const profiles = await UserProfile.find(profileFilter).select('userId supabase_user_id supabaseId name firstName lastName email mobile tenantId').sort({ updatedAt: -1 }).limit(limit).lean();
        const ids = [...new Set(profiles.flatMap(profile => [profile.userId, profile.supabase_user_id, profile.supabaseId]).filter(Boolean).map(String))];
        const orders = ids.length ? await Order.find({ $or: [{ userId: { $in: ids } }, { customerId: { $in: ids } }] }).select('userId customerId customerName customerMobile createdAt finalTotal orderStatus').sort({ createdAt: -1 }).lean() : [];
        const stats = new Map();
        for (const order of orders) { const id = String(order.userId || order.customerId || ''); if (!ids.includes(id)) continue; const item = stats.get(id) || { orderCount: 0, deliveredCount: 0, lifetimeSpend: 0, lastOrderAt: null, recentOrderCount90d: 0 }; item.orderCount += 1; if (/^Delivered$/i.test(order.orderStatus || '')) item.deliveredCount += 1; item.lifetimeSpend += Number(order.finalTotal || 0); const created = new Date(order.createdAt); if (!item.lastOrderAt || created > new Date(item.lastOrderAt)) item.lastOrderAt = order.createdAt; if (created >= new Date(Date.now() - 90 * 86400000)) item.recentOrderCount90d += 1; stats.set(id, item); }
        const customers = profiles.map(profile => { const id = String(profile.userId || profile.supabase_user_id || profile.supabaseId); const s = stats.get(id) || { orderCount: 0, deliveredCount: 0, lifetimeSpend: 0, lastOrderAt: null, recentOrderCount90d: 0 }; return { customerId: id, name: profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Customer', email: profile.email || '', mobile: profile.mobile || '', ...s, frequency: s.recentOrderCount90d >= 3 ? 'FREQUENT' : s.orderCount ? 'RECENT' : 'NEW' }; }).sort((a,b) => b.recentOrderCount90d-a.recentOrderCount90d || b.orderCount-a.orderCount || new Date(b.lastOrderAt || 0)-new Date(a.lastOrderAt || 0));
        return res.json({ success: true, customers });
    } catch (error) { console.error('Customer list failed:', error); return res.status(500).json({ success: false, message: 'Could not load recent customers.' }); }
});

router.get('/admin/customer-promotions', authenticateUser, requirePermission('promotions.read'), requireTenantPromotionAccess, async (req, res) => {
    if (!getIsConnected() || mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Promotion data is temporarily unavailable.' });
    try { const tenantId = getTenantId(req); const filter = { customerId: { $ne: null }, promotionType: { $in: ['CUSTOMER_DISCOUNT','CUSTOMER_COUPON'] } }; if (tenantId && !isPlatformRole(getRole(req))) filter.tenantId = tenantId; const promotions = await Coupon.find(filter).sort({ createdAt: -1 }).limit(200).lean(); return res.json({ success: true, promotions }); } catch { return res.status(500).json({ success: false, message: 'Could not load customer promotions.' }); }
});

router.post('/admin/customer-promotions', authenticateUser, requirePermission('promotions.manage'), requireTenantPromotionAccess, async (req, res) => {
    if (!getIsConnected() || mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'Promotion data is temporarily unavailable.' });
    try {
        const role = getRole(req); const tenantId = getTenantId(req) || (isPlatformRole(role) ? String(req.body.tenantId || '').trim() || null : null); if (!tenantId && !isPlatformRole(role)) return res.status(400).json({ success: false, message: 'Your tenant context is required.' });
        const customerId = String(req.body.customerId || '').trim(); if (!customerId) return res.status(400).json({ success: false, message: 'Select a customer.' });
        const customerFilter = { $or: [{ userId: customerId }, { supabase_user_id: customerId }, { supabaseId: customerId }] }; if (tenantId) customerFilter.tenantId = tenantId; const customer = await UserProfile.findOne(customerFilter).select('userId supabase_user_id supabaseId tenantId').lean(); if (!customer) return res.status(404).json({ success: false, message: 'Customer does not belong to this tenant.' });
        const discountType = req.body.discountType || 'percentage'; const value = Number(req.body.discountValue); const minimum = Number(req.body.minOrderAmount || 0); if (!['percentage','fixed'].includes(discountType) || !Number.isFinite(value) || value <= 0 || (discountType === 'percentage' && value > 100) || !Number.isFinite(minimum) || minimum < 0) return res.status(400).json({ success: false, message: 'Enter a valid discount type, value and minimum order amount.' });
        const expiryDate = req.body.expiryDate ? new Date(req.body.expiryDate) : null; if (expiryDate && Number.isNaN(expiryDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid expiry date.' });
        let code = String(req.body.code || '').trim().toUpperCase(); if (!code) code = 'PHARMA-' + Math.random().toString(36).slice(2, 8).toUpperCase(); if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return res.status(400).json({ success: false, message: 'Coupon code must be 3–40 letters, numbers, underscores, or hyphens.' });
        const promotionType = req.body.promotionType === 'CUSTOMER_COUPON' ? 'CUSTOMER_COUPON' : 'CUSTOMER_DISCOUNT';
        const promotion = await Coupon.create({ code, discountType, discountValue: value, discountPercentage: discountType === 'percentage' ? value : 0, minOrderAmount: minimum, minOrderValue: minimum, expiryDate, usageLimit: req.body.usageLimit == null ? null : Number(req.body.usageLimit), isActive: true, tenantId, customerId: String(customer.userId || customer.supabase_user_id || customer.supabaseId), autoApply: true, promotionLabel: String(req.body.promotionLabel || 'Pharma discount for you').trim().slice(0, 120), promotionType });
        return res.status(201).json({ success: true, promotion });
    } catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, message: 'That coupon code already exists.' }); return res.status(500).json({ success: false, message: error.message || 'Failed to create customer promotion.' }); }
});

router.patch('/admin/customer-promotions/:id', authenticateUser, requirePermission('promotions.manage'), requireTenantPromotionAccess, async (req, res) => {
    if (!getIsConnected() || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid promotion.' });
    try { const tenantId = getTenantId(req); const filter = { _id: req.params.id, customerId: { $ne: null } }; if (tenantId && !isPlatformRole(getRole(req))) filter.tenantId = tenantId; const promotion = await Coupon.findOneAndUpdate(filter, { $set: { isActive: req.body.isActive !== false } }, { new: true }).lean(); if (!promotion) return res.status(404).json({ success: false, message: 'Promotion not found.' }); return res.json({ success: true, promotion }); } catch { return res.status(500).json({ success: false, message: 'Failed to update promotion.' }); }
});


router.post('/', authenticateUser, (req, res, next) => {
    if (req.user?.app_metadata?.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Administrator privileges are required to create coupons.' });
    }
    return next();
}, async (req, res) => {
    if (!getIsConnected() || mongoose.connection.readyState !== 1) {
        return res.status(503).json({ success: false, error: 'MongoDB is unavailable. Coupon was not saved.' });
    }
    try {
        const {
            code,
            discountType = 'percentage',
            discountValue,
            discountPercentage,
            minOrderAmount,
            minOrderValue,
            expiryDate,
            usageLimit
        } = req.body || {};
        const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
        const value = Number(discountValue ?? discountPercentage);
        const minimum = Number(minOrderAmount ?? minOrderValue ?? 0);
        if (!/^[A-Z0-9_-]{3,40}$/.test(normalizedCode)) {
            return res.status(400).json({ success: false, error: 'Code must be 3–40 letters, numbers, underscores, or hyphens.' });
        }
        if (!['percentage', 'fixed'].includes(discountType)) {
            return res.status(400).json({ success: false, error: 'discountType must be percentage or fixed.' });
        }
        if (!Number.isFinite(value) || value <= 0 || (discountType === 'percentage' && value > 100)) {
            return res.status(400).json({ success: false, error: 'discountValue must be positive and percentage discounts cannot exceed 100.' });
        }
        if (!Number.isFinite(minimum) || minimum < 0) {
            return res.status(400).json({ success: false, error: 'minOrderAmount must be a non-negative number.' });
        }
        if (expiryDate && Number.isNaN(new Date(expiryDate).getTime())) {
            return res.status(400).json({ success: false, error: 'expiryDate must be a valid date.' });
        }
        if (usageLimit !== undefined && usageLimit !== null
            && (!Number.isInteger(Number(usageLimit)) || Number(usageLimit) < 0)) {
            return res.status(400).json({ success: false, error: 'usageLimit must be a non-negative whole number.' });
        }

        const coupon = await Coupon.create({
            code: normalizedCode,
            discountType,
            discountValue: value,
            discountPercentage: discountType === 'percentage' ? value : 0,
            minOrderAmount: minimum,
            minOrderValue: minimum,
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            usageLimit: usageLimit === undefined || usageLimit === null ? null : Number(usageLimit),
            isActive: true
        });
        return res.status(201).json({ success: true, coupon });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, error: 'A coupon with this code already exists.' });
        }
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            return res.status(400).json({ success: false, error: error.message });
        }
        console.error('Error creating coupon:', error);
        return res.status(500).json({ success: false, error: 'Failed to create coupon.' });
    }
});

router.get('/:code', async (req, res) => {
    if (!getIsConnected() || mongoose.connection.readyState !== 1) {
        return res.status(503).json({ success: false, error: 'MongoDB is unavailable. Coupon validation cannot be completed.' });
    }
    try {
        const code = String(req.params.code || '').trim().toUpperCase();
        const orderTotal = Number(req.query.orderTotal ?? req.query.currentCartTotal ?? 0);
        if (!code) return res.status(400).json({ success: false, error: 'Coupon code is required.' });
        if (!Number.isFinite(orderTotal) || orderTotal < 0) {
            return res.status(400).json({ success: false, error: 'Order total must be a non-negative number.' });
        }

        const coupon = await Coupon.findOne({ code }).lean();
        if (!coupon || !coupon.isActive) {
            return res.status(404).json({ success: false, error: 'Coupon was not found or is inactive.' });
        }
        if (coupon.expiryDate && new Date(coupon.expiryDate) <= new Date()) {
            return res.status(404).json({ success: false, error: 'Coupon has expired.' });
        }
        if (coupon.usageLimit != null && Number(coupon.usageCount || 0) >= coupon.usageLimit) {
            return res.status(404).json({ success: false, error: 'Coupon usage limit has been reached.' });
        }
        const minimum = Number(coupon.minOrderAmount ?? coupon.minOrderValue ?? 0);
        if (orderTotal < minimum) {
            return res.status(400).json({
                success: false,
                error: `A minimum order of ${minimum} is required for this coupon.`,
                minOrderAmount: minimum,
                orderTotal
            });
        }

        const type = coupon.discountType || 'percentage';
        const value = Number(coupon.discountValue ?? coupon.discountPercentage ?? 0);
        const discountAmount = type === 'fixed'
            ? Math.min(value, orderTotal)
            : Math.round((orderTotal * value / 100 + Number.EPSILON) * 100) / 100;
        return res.status(200).json({
            success: true,
            coupon: {
                code: coupon.code,
                discountType: type,
                discountValue: value,
                minOrderAmount: minimum,
                expiryDate: coupon.expiryDate
            },
            orderTotal,
            discountAmount,
            finalTotal: Math.max(0, orderTotal - discountAmount)
        });
    } catch (error) {
        console.error('Error validating coupon:', error);
        return res.status(500).json({ success: false, error: 'Could not validate coupon.' });
    }
});

router.get('/validate/:code', async (req, res) => {
    try {
        if (!getIsConnected() || mongoose.connection.readyState !== 1) {
            return res.status(503).json({ valid: false, message: 'MongoDB is unavailable. Coupon validation cannot be completed.' });
        }
        const code = String(req.params.code || '').trim().toUpperCase();
        const orderTotal = Number(req.query.orderTotal ?? 0);
        if (!Number.isFinite(orderTotal) || orderTotal < 0) {
            return res.status(400).json({ valid: false, message: 'Order total must be a non-negative number.' });
        }
        const coupon = await Coupon.findOne({ code }).lean();
        if (!coupon || !coupon.isActive
            || (coupon.expiryDate && new Date(coupon.expiryDate) <= new Date())
            || (coupon.usageLimit != null && Number(coupon.usageCount || 0) >= coupon.usageLimit)) {
            return res.status(404).json({ valid: false, message: 'Invalid or expired promo code.' });
        }
        const minimum = Number(coupon.minOrderAmount ?? coupon.minOrderValue ?? 0);
        if (orderTotal < minimum) {
            return res.status(400).json({
                valid: false,
                message: `Minimum order amount of ₹${minimum} required for this coupon.`
            });
        }
        const discountType = coupon.discountType || 'percentage';
        const discountValue = Number(coupon.discountValue ?? coupon.discountPercentage ?? 0);
        const discountAmount = discountType === 'fixed'
            ? Math.min(discountValue, orderTotal)
            : Math.round((orderTotal * discountValue / 100 + Number.EPSILON) * 100) / 100;
        return res.status(200).json({
            valid: true,
            code: coupon.code,
            discountPercentage: discountType === 'percentage' ? discountValue : 0,
            discountType,
            discountValue,
            discountAmount,
            finalTotal: Math.max(0, orderTotal - discountAmount)
        });
    } catch (err) {
        console.error('Error validating coupon:', err);
        return res.status(500).json({ valid: false, message: 'Coupon validation failed.' });
    }
});

export default router;
