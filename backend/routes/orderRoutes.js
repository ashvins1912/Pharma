import express from 'express';
import dataStore from '../dataStore.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';
import { sendCustomWhatsAppAlert, getNotificationLog } from '../config/whatsapp.js';

const router = express.Router();

// Customer Checkout
router.post('/checkout', authenticateUser, async (req, res) => {
    try {
        const { cartItems, totalAmount, finalTotal, addressId, deliveryAddress, coordinates, paymentMethod } = req.body;
        
        let chosenAddressLine = deliveryAddress;
        let chosenCoords = coordinates;

        let addressSnapshot = null;
        if (addressId) {
            addressSnapshot = await dataStore.getUserAddress(req.user.sub, addressId);
            if (!addressSnapshot) {
                return res.status(400).json({ message: "Selected delivery address was not found. Refresh your address list and try again." });
            }
            chosenAddressLine = addressSnapshot.addressLine || `${addressSnapshot.addressLine1}, ${addressSnapshot.city} - ${addressSnapshot.pincode}`;
            chosenCoords = addressSnapshot.coordinates;
        }

        if (!chosenAddressLine) {
            chosenAddressLine = "Bengaluru City Center Delivery Address";
            chosenCoords = { lat: 12.9716, lng: 77.5946 };
        }

        const customerName = req.user.user_metadata?.name || req.user.email?.split('@')[0] || "Customer";

        const order = await dataStore.createOrder({
            userId: req.user.sub,
            customerName,
            items: cartItems || [],
            subtotal: totalAmount || 0,
            finalTotal: finalTotal || totalAmount || 0,
            deliveryAddress: chosenAddressLine,
            addressDetails: addressSnapshot ? {
                label: addressSnapshot.label,
                fullName: addressSnapshot.fullName,
                mobile: addressSnapshot.mobile,
                addressLine1: addressSnapshot.addressLine1,
                addressLine2: addressSnapshot.addressLine2,
                city: addressSnapshot.city,
                state: addressSnapshot.state,
                pincode: addressSnapshot.pincode,
                landmark: addressSnapshot.landmark,
                coordinates: addressSnapshot.coordinates
            } : {},
            coordinates: chosenCoords || { lat: 12.9716, lng: 77.5946 },
            customerMobile: addressSnapshot?.mobile || req.body.mobile || "+91 95899 16475",
            paymentMethod: paymentMethod || "Cash on Delivery (COD)"
        }, customerName);

        // Automated messaging trigger
        await sendCustomWhatsAppAlert(order, 'Placed');

        res.status(201).json({
            message: "🎉 Cash-on-Delivery order registered into dispensary queue!",
            orderId: order._id,
            order
        });
    } catch (err) {
        console.error("Checkout failed:", err);
        res.status(400).json({ message: err.message || "Checkout failed" });
    }
});

// Order State Machine Transition
router.post('/admin/transition', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { orderId, newStatus, riderInfo } = req.body;
        if (!orderId || !newStatus) {
            return res.status(400).json({ message: "orderId and newStatus are required." });
        }

        const actor = req.user.user_metadata?.name || req.user.email || 'Pharmacist Admin';
        const updatedOrder = await dataStore.transitionOrderStatus(orderId, newStatus, actor, riderInfo);

        // Trigger notification according to lifecycle
        let eventType = null;
        if (newStatus === 'Ready to Dispatch') eventType = 'Ready to Dispatch';
        else if (newStatus === 'Dispatched') eventType = 'Dispatched';
        else if (newStatus === 'Delivered') eventType = 'Delivered';

        if (eventType) {
            await sendCustomWhatsAppAlert(updatedOrder, eventType, updatedOrder.rider?.riderMobile);
        }

        res.json({
            message: `Order transitioned to ${newStatus}`,
            order: updatedOrder
        });
    } catch (err) {
        console.error("Transition error:", err);
        res.status(400).json({ message: err.message || "State transition failed" });
    }
});

// Smart Delivery Route Clubbing & Google Maps link generation (Requirements 11, 12, 13, 14)
router.post('/admin/optimize-and-club-routes', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { deliveryPersonName, deliveryPersonMobile, maxRadiusKm, startLat, startLng } = req.body;
        const result = await dataStore.clubDeliveryRoute(
            deliveryPersonName,
            deliveryPersonMobile,
            maxRadiusKm,
            Number(startLat) || 12.9716,
            Number(startLng) || 77.5946
        );

        res.json(result);
    } catch (e) {
        console.error("Routing optimization error:", e);
        res.status(500).json({ message: "Routing optimization failed: " + e.message });
    }
});

// Dispatch batch of clubbed orders to rider
router.post('/admin/dispatch-batch', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { orderIds, riderName, riderMobile } = req.body;
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ message: "No order IDs provided for dispatch." });
        }

        const actor = req.user.user_metadata?.name || req.user.email || 'Logistics Admin';
        const riderInfo = {
            riderId: `rider-${Date.now()}`,
            riderName: riderName || "Rider",
            riderMobile: riderMobile || ""
        };

        const dispatchedOrders = [];
        for (const id of orderIds) {
            try {
                const updated = await dataStore.transitionOrderStatus(id, 'Dispatched', actor, riderInfo);
                await sendCustomWhatsAppAlert(updated, 'Dispatched', riderMobile);
                dispatchedOrders.push(updated);
            } catch (err) {
                console.warn(`Could not dispatch order ${id}:`, err.message);
            }
        }

        res.json({
            message: `Successfully assigned and dispatched ${dispatchedOrders.length} orders to courier ${riderName || riderMobile}!`,
            dispatchedOrders
        });
    } catch (err) {
        res.status(500).json({ message: "Batch dispatch failed: " + err.message });
    }
});

// Legacy single-step transition shortcut
router.patch('/admin/:orderId/:step', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { orderId, step } = req.params;
        const actor = req.user.user_metadata?.name || req.user.email || 'Pharmacist Admin';
        let targetStatus = 'Processing Order';
        if (step === 'ready') targetStatus = 'Ready to Dispatch';
        if (step === 'dispatch') targetStatus = 'Dispatched';
        if (step === 'deliver') targetStatus = 'Delivered';

        const order = await dataStore.transitionOrderStatus(orderId, targetStatus, actor);
        if (step === 'ready') await sendCustomWhatsAppAlert(order, 'Ready to Dispatch');
        if (step === 'deliver') await sendCustomWhatsAppAlert(order, 'Delivered');

        res.json({ message: "Transaction status shifted safely.", order });
    } catch (err) {
        console.error("Order status update failed:", err);
        res.status(400).json({ message: err.message || "Failed to update order status." });
    }
});

// Admin All Orders
router.get('/admin/all', authenticateUser, isAdmin, async (req, res) => {
    try {
        const orders = await dataStore.getAllOrders();
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: "Failed to retrieve orders" });
    }
});

// Customer History
router.get('/history', authenticateUser, async (req, res) => {
    try {
        const orders = await dataStore.getUserOrders(req.user.sub);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: "Failed to retrieve history" });
    }
});

// Notification logs audit
router.get('/notifications/logs', authenticateUser, isAdmin, async (req, res) => {
    res.json(getNotificationLog());
});

export default router;
