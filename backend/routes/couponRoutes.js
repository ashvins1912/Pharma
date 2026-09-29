const express = require('express');
const router = express.Router();
const Coupon = require('../models/Coupon');
const { authenticateUser, isAdmin } = require('../middleware/auth');

router.post('/', authenticateUser, isAdmin, async (req, res) => {
    const newCoupon = new Coupon({ code: req.body.code.toUpperCase(), discountPercentage: req.body.discountPercentage });
    await newCoupon.save();
    res.status(201).json({ message: "🎟️ Promo code coupon now active inside database registers." });
});

router.get('/validate/:code', async (req, res) => {
    const coupon = await Coupon.findOne({ code: req.params.code.toUpperCase(), isActive: true });
    if (!coupon) return res.status(404).json({ valid: false });
    res.json({ valid: true, discountPercentage: coupon.discountPercentage });
});

module.exports = router;
