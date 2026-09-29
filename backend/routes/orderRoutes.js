const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Medicine = require('../models/Medicine');
const UserProfile = require('../models/UserProfile');
const { authenticateUser, isAdmin } = require('../middleware/auth');
const { sendCustomWhatsAppAlert } = require('../config/whatsapp');

function calculateDistanceInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

router.post('/checkout', authenticateUser, async (req, res) => {
    try {
        const { cartItems, totalAmount, finalTotal, addressId } = req.body;
        const profile = await UserProfile.findOne({ userId: req.user.sub });
        const chosenAddress = profile.addresses.id(addressId);

        const order = new Order({
            userId: req.user.sub,
            items: cartItems,
            subtotal: totalAmount,
            finalTotal,
            deliveryAddress: chosenAddress.addressLine,
            coordinates: chosenAddress.coordinates
        });
        await order.save();
        await sendCustomWhatsAppAlert(order, 'Placed');
        res.status(201).json({ message: "🎉 Checkout invoice recorded into system maps!", orderId: order._id });
    } catch (err) { res.status(500).json({ message: "Checkout failed" }); }
});

router.post('/admin/optimize-and-club-routes', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { deliveryPersonMobile, maxRadiusKm } = req.body;
        const pending = await Order.find({ orderStatus: 'Ready to Dispatch' });
        if (pending.length === 0) return res.status(400).json({ message: "No unassigned orders matching target parameters." });

        let batched = [];
        const baseOrder = pending[0];
        batched.push(baseOrder);

        for (let i = 1; i < pending.length; i++) {
            const dist = calculateDistanceInKm(baseOrder.coordinates.lat, baseOrder.coordinates.lng, pending[i].coordinates.lat, pending[i].coordinates.lng);
            if (dist <= maxRadiusKm) batched.push(pending[i]);
        }

        for (const order of batched) {
            order.orderStatus = 'Dispatched';
            order.deliveryPersonMobile = deliveryPersonMobile;
            await order.save();
            await sendCustomWhatsAppAlert(order, 'Dispatched', deliveryPersonMobile);
        }

        res.json({ message: `Successfully clubbed and optimized ${batched.length} deliveries onto a single route.` });
    } catch (e) { res.status(500).json({ message: "Routing optimization matrix failure." }); }
});

router.patch('/admin/:orderId/:step', authenticateUser, isAdmin, async (req, res) => {
    const order = await Order.findById(req.params.orderId);
    const step = req.params.step;

    if (step === 'ready') { order.orderStatus = 'Ready to Dispatch'; await sendCustomWhatsAppAlert(order, 'Ready to Dispatch'); }
    if (step === 'deliver') {
        for (const item of order.items) { await Medicine.findByIdAndUpdate(item._id, { $inc: { quantity: -Math.abs(item.quantity) } }); }
        order.orderStatus = 'Delivered';
        await sendCustomWhatsAppAlert(order, 'Delivered');
    }
    await order.save();
    res.json({ message: "Transaction status shifted safely.", order });
});

router.get('/admin/all', authenticateUser, isAdmin, async (req, res) => {
    res.json(await Order.find().sort({ createdAt: -1 }));
});

router.get('/history', authenticateUser, async (req, res) => {
    res.json(await Order.find({ userId: req.user.sub }).sort({ createdAt: -1 }));
});

module.exports = router;
