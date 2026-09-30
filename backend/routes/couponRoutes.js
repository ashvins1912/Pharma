import express from 'express';
import mongoose from 'mongoose';
import Coupon from '../models/Coupon.js';
import { authenticateSupabaseUser } from '../middleware/auth.js';
import { getIsConnected } from '../config/db.js';

const router = express.Router();

router.post('/', authenticateSupabaseUser, (req, res, next) => {
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
