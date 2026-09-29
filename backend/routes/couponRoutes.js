import express from 'express';
import dataStore from '../dataStore.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { code, discountPercentage, minOrderValue } = req.body;
        if (!code || !discountPercentage) {
            return res.status(400).json({ message: "Code and discountPercentage are required." });
        }
        await dataStore.createCoupon(code, discountPercentage, minOrderValue);
        res.status(201).json({ message: "🎟️ Promo code coupon now active inside database registers." });
    } catch (err) {
        console.error("Error creating coupon:", err);
        res.status(500).json({ message: "Failed to create coupon" });
    }
});

router.get('/validate/:code', async (req, res) => {
    try {
        const orderTotal = Number(req.query.orderTotal) || 0;
        const result = await dataStore.validateCoupon(req.params.code, orderTotal);
        if (!result.valid) return res.status(404).json(result);
        res.json(result);
    } catch (err) {
        console.error("Error validating coupon:", err);
        res.status(500).json({ valid: false, message: "Validation error" });
    }
});

export default router;
