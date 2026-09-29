import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';
import { sendCustomWhatsAppAlert, getNotificationLog } from '../config/whatsapp.js';
import { getPrescription, removePrescription, savePrescription } from '../config/prescriptionStorage.js';

const router = express.Router();
const getErrorStatus = (error) => {
    if (error.statusCode) return error.statusCode;
    if (['CastError', 'ValidationError'].includes(error.name)) return 400;
    if (['MongoServerError', 'MongoNetworkError', 'MongooseError'].includes(error.name)) return 503;
    return 500;
};
const allowedPrescriptionTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const uploadPrescription = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        if (!allowedPrescriptionTypes.has(file.mimetype)) {
            return callback(new Error('Prescription must be a PDF, JPEG, PNG, or WebP file.'));
        }
        callback(null, true);
    }
});

const parseCheckoutItems = (items) => {
    if (typeof items === 'string') {
        try {
            return JSON.parse(items);
        } catch {
            return null;
        }
    }
    return items;
};

const hasValidPrescriptionSignature = (file) => {
    if (!file) return true;
    if (file.mimetype === 'application/pdf') return file.buffer.subarray(0, 5).toString() === '%PDF-';
    if (file.mimetype === 'image/jpeg') {
        return file.buffer.length >= 3
            && file.buffer[0] === 0xff
            && file.buffer[1] === 0xd8
            && file.buffer[2] === 0xff;
    }
    if (file.mimetype === 'image/png') {
        return file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (file.mimetype === 'image/webp') {
        return file.buffer.subarray(0, 4).toString() === 'RIFF'
            && file.buffer.subarray(8, 12).toString() === 'WEBP';
    }
    return false;
};

const handlePrescriptionUpload = (req, res, next) => {
    uploadPrescription.single('prescription')(req, res, error => {
        if (error) return res.status(400).json({ message: error.message || 'Invalid prescription upload.' });
        if (!hasValidPrescriptionSignature(req.file)) {
            return res.status(400).json({ message: 'The uploaded file does not match its declared image or PDF format.' });
        }
        next();
    });
};

// Customer Checkout
router.post('/checkout', authenticateUser, handlePrescriptionUpload, async (req, res) => {
    let uploadedPrescriptionUrl = null;
    try {
        const { addressId, deliveryAddress, coordinates, paymentMethod, prescriptionUrl, couponCode } = req.body;
        const cartItems = parseCheckoutItems(req.body.items || req.body.cartItems);
        if (!Array.isArray(cartItems) || !cartItems.length) {
            return res.status(400).json({ message: 'Add at least one medicine to your order.' });
        }
        
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
        }

        const customerName = req.user.user_metadata?.name || req.user.email?.split('@')[0] || "Customer";
        if (prescriptionUrl && !prescriptionUrl.startsWith('/api/orders/prescriptions/')) {
            return res.status(400).json({ message: 'Prescription URL must refer to a private uploaded prescription.' });
        }
        uploadedPrescriptionUrl = req.file
            ? await savePrescription(req.file, req.user.sub)
            : (prescriptionUrl || null);
        if (prescriptionUrl && !req.file) {
            const existingPrescription = await getPrescription(prescriptionUrl.split('/').at(-1));
            if (!existingPrescription || existingPrescription.ownerId !== req.user.sub) {
                return res.status(403).json({ message: 'The uploaded prescription does not belong to this account.' });
            }
        }

        const order = await dataStore.reserveOrder({
            userId: req.user.sub,
            customerName,
            customerMobile: addressSnapshot?.mobile || req.body.mobile || req.user.user_metadata?.mobile || '',
            items: cartItems,
            couponCode,
            prescriptionUrl: uploadedPrescriptionUrl,
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
            coordinates: chosenCoords,
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
        if (uploadedPrescriptionUrl?.startsWith('/api/orders/prescriptions/')) {
            try {
                await removePrescription(uploadedPrescriptionUrl);
            } catch (cleanupError) {
                console.error('Prescription cleanup failed after checkout error:', cleanupError);
            }
        }
        console.error("Checkout failed:", err);
        res.status(getErrorStatus(err)).json({ message: err.message || "Checkout failed" });
    }
});

// Prescription uploads are private files backed by MongoDB GridFS when configured.
router.get('/prescriptions/:fileId', authenticateUser, async (req, res) => {
    try {
        const prescription = await getPrescription(req.params.fileId);
        if (!prescription) return res.status(404).json({ message: 'Prescription file not found.' });
        const role = req.user?.role || req.user?.user_metadata?.role;
        if (prescription.ownerId !== req.user.sub && role !== 'admin') {
            return res.status(403).json({ message: 'You are not authorized to view this prescription.' });
        }
        res.set('Content-Type', prescription.contentType);
        res.set('Content-Disposition', 'inline; filename="prescription"');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'private, no-store');
        if (prescription.stream) {
            prescription.stream.on('error', error => {
                console.error('Prescription download failed:', error);
                if (!res.headersSent) res.status(500).end();
            });
            prescription.stream.pipe(res);
        } else {
            res.send(prescription.buffer);
        }
    } catch (err) {
        console.error('Prescription retrieval failed:', err);
        res.status(500).json({ message: 'Failed to retrieve prescription.' });
    }
});

router.put('/:id/review', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { status, decision } = req.body;
        const reviewDecision = status || decision;
        if (!['Approved', 'Rejected'].includes(reviewDecision)) {
            return res.status(400).json({ message: 'Review status must be Approved or Rejected.' });
        }
        if (reviewDecision === 'Approved' && !req.body.prescriptionVerified) {
            return res.status(400).json({ message: 'Confirm prescription verification before approving this order.' });
        }

        const order = await dataStore.reviewOrder(
            req.params.id,
            reviewDecision === 'Approved' ? 'approve' : 'reject',
            req.user.user_metadata?.name || req.user.email || 'Admin'
        );
        res.json({ message: `Order ${reviewDecision.toLowerCase()}.`, order });
    } catch (err) {
        console.error('Order review failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to review order.' });
    }
});

router.put('/:id/dispatch', authenticateUser, isAdmin, async (req, res) => {
    try {
        const order = await dataStore.dispatchOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Admin',
            req.body.riderInfo || null
        );
        await sendCustomWhatsAppAlert(order, 'Dispatched', order.rider?.riderMobile);
        res.json({ message: 'Order dispatched and reserved inventory deducted.', order });
    } catch (err) {
        console.error('Order dispatch failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to dispatch order.' });
    }
});

router.put('/:id/cancel', authenticateUser, async (req, res) => {
    try {
        const role = req.user?.role || req.user?.user_metadata?.role;
        const customerId = role === 'admin' ? null : req.user.sub;
        const order = await dataStore.cancelOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Customer',
            customerId
        );
        res.json({ message: 'Order cancelled and reserved stock released.', order });
    } catch (err) {
        console.error('Order cancellation failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to cancel order.' });
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
        if (step === 'dispatch') await sendCustomWhatsAppAlert(order, 'Dispatched', order.rider?.riderMobile);
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
    try {
        res.json(await getNotificationLog());
    } catch (err) {
        console.error("Notification log retrieval failed:", err);
        res.status(500).json({ message: "Failed to retrieve notification logs" });
    }
});

export default router;
