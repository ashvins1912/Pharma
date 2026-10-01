import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import Order from '../models/Order.js';
import Rider from '../models/Rider.js';
import { authenticateUser, authenticateSupabaseUser, isAdmin } from '../middleware/auth.js';
import { getNotificationLog } from '../config/whatsapp.js';
import { getPrescription, removePrescription, savePrescription } from '../config/prescriptionStorage.js';
import { getIsConnected } from '../config/db.js';
import DynamicOrderService from '../services/DynamicOrderService.js';
import deliveryContainer from '../modules/delivery/container.js';
import { publishOrderEvent, toOrderEventType } from '../services/OrderEventService.js';

const router = express.Router();
const dynamicOrderService = new DynamicOrderService({
    couponValidator: (code, subtotal) => dataStore.validateCoupon(code, subtotal)
});
const getErrorStatus = (error) => {
    if (error.statusCode) return error.statusCode;
    if (['CastError', 'ValidationError'].includes(error.name)) return 400;
    if (['MongoServerError', 'MongoNetworkError', 'MongooseError'].includes(error.name)) return 503;
    return 500;
};
const resolveDispatchRider = async (riderId, orderId = null) => {
    if (!getIsConnected()) {
        throw Object.assign(new Error('Dispatch requires an active MongoDB connection.'), { statusCode: 503 });
    }
    if (!riderId) {
        throw Object.assign(new Error('Select an onboarded rider before dispatching.'), { statusCode: 400 });
    }
    deliveryContainer.refreshDataLayer();
    const rider = await deliveryContainer.riderRepository.findById(riderId);
    if (!rider || !rider.enabled) {
        throw Object.assign(new Error('The selected onboarded rider is unavailable.'), { statusCode: 404 });
    }
    const alreadyAssigned = orderId != null &&
        (rider.activeOrderIds || []).some(activeOrderId => String(activeOrderId) === String(orderId));
    if (rider.status !== 'Available' && !alreadyAssigned) {
        throw Object.assign(new Error('The selected rider is no longer available.'), { statusCode: 409 });
    }
    return {
        riderId: rider.id,
        riderName: rider.name,
        riderMobile: rider.mobile
    };
};
const allowedPrescriptionTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const normalizedOrderStatuses = ['pending', 'accepted', 'out_for_delivery', 'delivered', 'cancelled'];
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

const hasValidCoordinates = (coordinates) => {
    if (coordinates?.lat == null || coordinates?.lng == null
        || String(coordinates.lat).trim() === '' || String(coordinates.lng).trim() === '') return false;
    const lat = Number(coordinates?.lat);
    const lng = Number(coordinates?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90
        && lng >= -180 && lng <= 180;
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

router.post('/', authenticateSupabaseUser, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ error: 'MongoDB is unavailable. Order was not created.' });
    }
    try {
        const { items, totalAmount } = req.body || {};
        if (!Array.isArray(items) || items.length === 0 || items.some(item =>
            !item || typeof item !== 'object' || Array.isArray(item)
            || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1
        )) {
            return res.status(400).json({ error: 'Order items must be a non-empty list with a positive whole-number quantity per item.' });
        }
        const amount = Number(totalAmount);
        if (!Number.isFinite(amount) || amount < 0) {
            return res.status(400).json({ error: 'totalAmount must be a non-negative number.' });
        }
        if (typeof req.body.deliveryAddress !== 'string' || !req.body.deliveryAddress.trim()) {
            return res.status(400).json({ error: 'A deliveryAddress is required for an order.' });
        }
        const order = await Order.create({
            customerId: req.user.sub,
            userId: req.user.sub,
            riderId: null,
            items,
            totalAmount: amount,
            finalTotal: amount,
            deliveryAddress: req.body.deliveryAddress.trim(),
            addressDetails: req.body.addressDetails || {},
            coordinates: req.body.coordinates,
            location: req.body.location,
            customerName: req.user.user_metadata?.name || req.user.email || 'Customer',
            customerMobile: req.user.user_metadata?.mobile || '',
            paymentMethod: req.body.paymentMethod || 'Cash on Delivery (COD)',
            status: 'pending',
            orderStatus: 'Pending_Review'
        });
        return res.status(201).json({ order });
    } catch (error) {
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Order creation failed:', error);
        return res.status(500).json({ error: 'Could not create order.' });
    }
});

router.get('/', authenticateSupabaseUser, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ error: 'MongoDB is unavailable. Orders cannot be fetched.' });
    }
    try {
        const { status, customerId, riderId } = req.query;
        if (status && !normalizedOrderStatuses.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${normalizedOrderStatuses.join(', ')}.` });
        }
        if (riderId && !mongoose.isValidObjectId(riderId)) {
            return res.status(400).json({ error: 'riderId must be a valid rider ID.' });
        }
        const isAdminUser = req.user?.app_metadata?.role === 'admin';
        const query = {};
        if (status) query.status = status;
        if (isAdminUser) {
            if (customerId) query.customerId = customerId;
            if (riderId) query.riderId = riderId;
        } else if (riderId) {
            const rider = await Rider.findOne({ supabaseId: req.user.sub, _id: riderId }).select('_id').lean();
            if (!rider) return res.status(403).json({ error: 'You can only fetch orders assigned to your rider profile.' });
            query.riderId = rider._id;
        } else {
            query.customerId = req.user.sub;
        }
        const orders = await Order.find(query).sort({ createdAt: -1 }).lean();
        return res.json({ orders });
    } catch (error) {
        console.error('Order retrieval failed:', error);
        return res.status(500).json({ error: 'Could not fetch orders.' });
    }
});

// Customer Checkout
router.post('/checkout', authenticateUser, handlePrescriptionUpload, async (req, res) => {
    let uploadedPrescriptionUrl = null;
    try {
        const {
            addressId, deliveryAddress, coordinates, paymentMethod, prescriptionUrl, couponCode
        } = req.body;
        const pointsToRedeem = Number(req.body.pointsToRedeem || 0);
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

        if (!chosenAddressLine?.trim() || !hasValidCoordinates(chosenCoords)) {
            return res.status(400).json({ message: 'A delivery address with a confirmed map pin is required to place an order.' });
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
            pointsToRedeem,
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

        await publishOrderEvent(order, 'OrderCreated');
        await publishOrderEvent(order, 'OrderInventoryReserved');

        res.status(201).json({
            message: "🎉 Cash-on-Delivery order registered into dispensary queue!",
            orderId: order._id,
            rewardNotice: order.rewardNotice || null,
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

router.get('/dynamic-restock', authenticateUser, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ message: 'Personalized restock is temporarily unavailable.' });
    }
    try {
        const items = await dynamicOrderService.generateDynamicRestockBasket(req.user.sub);
        return res.json({ items });
    } catch (error) {
        console.error('Dynamic restock generation failed:', error);
        return res.status(500).json({ message: 'Failed to generate your restock basket.' });
    }
});

router.post('/checkout/quote', authenticateUser, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ message: 'Reward quotes are temporarily unavailable.' });
    }
    try {
        const items = parseCheckoutItems(req.body.items || req.body.cartItems);
        const pointsToRedeem = Number(req.body.pointsToRedeem || 0);
        const quote = await dynamicOrderService.evaluateCheckout(
            items,
            req.user.sub,
            pointsToRedeem,
            { couponCode: req.body.couponCode || undefined }
        );
        return res.json(quote);
    } catch (error) {
        console.error('Checkout reward quote failed:', error);
        return res.status(error.statusCode || 400).json({
            message: error.message || 'Unable to calculate the reward quote.'
        });
    }
});

// Prescription uploads are private files backed by MongoDB GridFS when configured.
router.get('/prescriptions/:fileId', authenticateUser, async (req, res) => {
    try {
        const prescription = await getPrescription(req.params.fileId);
        if (!prescription) return res.status(404).json({ message: 'Prescription file not found.' });
        const role = req.user?.app_metadata?.role || req.user?.role;
        if (prescription.ownerId !== req.user.sub && role !== 'admin' && role !== 'pharmacy') {
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

        let order = await dataStore.reviewOrder(
            req.params.id,
            reviewDecision === 'Approved' ? 'approve' : 'reject',
            req.user.user_metadata?.name || req.user.email || 'Admin'
        );
        await publishOrderEvent(order, reviewDecision === 'Approved' ? 'OrderApproved' : 'OrderRejected');
        if (reviewDecision === 'Rejected') await publishOrderEvent(order, 'OrderInventoryReleased');

        let assignmentMessage = '';
        if (reviewDecision === 'Approved') {
            try {
                deliveryContainer.refreshDataLayer();
                const result = await deliveryContainer.assignmentEngine.assignOrder(String(order._id));
                if (result.success) {
                    order = result.order.toJSON ? result.order.toJSON() : result.order;
                    assignmentMessage = ` Rider ${result.rider.name} was assigned automatically.`;
                    await publishOrderEvent(order, 'OrderAssigned', { payload: { riderMobile: result.rider.mobile } });
                } else {
                    assignmentMessage = ' No available rider was found; assign one manually.';
                }
            } catch (assignmentError) {
                console.error(`[AutoAssign] Assignment failed for approved order ${order._id}:`, assignmentError);
                assignmentMessage = ' Automatic assignment failed; assign a rider manually.';
            }
        }

        res.json({ message: `Order ${reviewDecision.toLowerCase()}.${assignmentMessage}`, order });
    } catch (err) {
        console.error('Order review failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to review order.' });
    }
});

router.put('/:id/dispatch', authenticateUser, isAdmin, async (req, res) => {
    try {
        const riderInfo = await resolveDispatchRider(req.body.riderInfo?.riderId, req.params.id);
        const order = await dataStore.dispatchOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Admin',
            riderInfo
        );
        await publishOrderEvent(order, 'OrderDispatched');
        await publishOrderEvent(order, 'OrderInventoryDeducted');
        res.json({ message: 'Order dispatched and reserved inventory deducted.', order });
    } catch (err) {
        console.error('Order dispatch failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to dispatch order.' });
    }
});

router.put('/:id/modify', authenticateUser, handlePrescriptionUpload, async (req, res) => {
    let uploadedPrescriptionUrl = null;
    let newlyUploadedPrescriptionUrl = null;
    try {
        if (req.user?.app_metadata?.role === 'admin') {
            return res.status(403).json({ message: 'Customers can only modify their own orders.' });
        }
        const items = parseCheckoutItems(req.body.items);
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'An order must contain at least one medicine.' });
        }
        const previousPrescriptionUrl = req.body.previousPrescriptionUrl || null;
        if (previousPrescriptionUrl && !previousPrescriptionUrl.startsWith('/api/orders/prescriptions/')) {
            return res.status(400).json({ message: 'Prescription URL must refer to a private uploaded prescription.' });
        }
        if (previousPrescriptionUrl) {
            const previousPrescription = await getPrescription(previousPrescriptionUrl.split('/').at(-1));
            if (!previousPrescription || previousPrescription.ownerId !== req.user.sub) {
                return res.status(403).json({ message: 'The uploaded prescription does not belong to this account.' });
            }
        }
        if (req.file) {
            uploadedPrescriptionUrl = await savePrescription(req.file, req.user.sub);
            newlyUploadedPrescriptionUrl = uploadedPrescriptionUrl;
        } else {
            uploadedPrescriptionUrl = previousPrescriptionUrl || undefined;
        }
        const order = await dataStore.updateCustomerOrder(
            req.params.id,
            req.user.sub,
            items,
            uploadedPrescriptionUrl,
            req.user.user_metadata?.name || req.user.email || 'Customer'
        );
        await publishOrderEvent(order, 'OrderUpdated');
        if (previousPrescriptionUrl && newlyUploadedPrescriptionUrl && previousPrescriptionUrl !== newlyUploadedPrescriptionUrl) {
            try {
                await removePrescription(previousPrescriptionUrl);
            } catch (cleanupError) {
                console.error('Replaced prescription cleanup failed:', cleanupError);
            }
        }
        res.json({ message: 'Order updated and sent for pharmacist review.', order });
    } catch (err) {
        if (newlyUploadedPrescriptionUrl) {
            try {
                await removePrescription(newlyUploadedPrescriptionUrl);
            } catch (cleanupError) {
                console.error('Prescription cleanup failed after order update error:', cleanupError);
            }
        }
        console.error('Customer order update failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to update order.' });
    }
});

router.delete('/:id', authenticateUser, (req, res) => {
    res.status(403).json({ message: 'Orders cannot be deleted. Cancel an eligible order instead.' });
});

router.put('/:id/cancel', authenticateUser, async (req, res) => {
    try {
        if (req.user?.app_metadata?.role === 'admin') {
            return res.status(403).json({ message: 'Customers can only cancel their own orders.' });
        }
        const order = await dataStore.cancelOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Customer',
            req.user.sub
        );
        await publishOrderEvent(order, 'OrderCancelled');
        await publishOrderEvent(order, 'OrderInventoryReleased');
        res.json({ message: 'Order cancelled and reserved stock released.', order });
    } catch (err) {
        console.error('Order cancellation failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to cancel order.' });
    }
});

// Order State Machine Transition
router.post('/admin/transition', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { orderId, newStatus } = req.body;
        let { riderInfo } = req.body;
        if (!orderId || !newStatus) {
            return res.status(400).json({ message: "orderId and newStatus are required." });
        }
        if (newStatus === 'Dispatched') {
            deliveryContainer.refreshDataLayer();
            const currentOrder = await deliveryContainer.orderRepository.findById(orderId);
            riderInfo = await resolveDispatchRider(
                riderInfo?.riderId || currentOrder?.rider?.riderId,
                orderId
            );
        }

        const actor = req.user.user_metadata?.name || req.user.email || 'Pharmacist Admin';
        let updatedOrder = await dataStore.transitionOrderStatus(orderId, newStatus, actor, riderInfo);
        if (newStatus === 'Dispatched') await publishOrderEvent(updatedOrder, 'OrderInventoryDeducted');
        if (newStatus === 'Cancelled') await publishOrderEvent(updatedOrder, 'OrderInventoryReleased');
        let assignmentMessage = '';
        let notificationEvent = newStatus === 'Ready to Dispatch' ? 'Ready to Dispatch' : null;
        let notificationMobile = updatedOrder.rider?.riderMobile;

        if (newStatus === 'Approved' || newStatus === 'Ready to Dispatch') {
            try {
                deliveryContainer.refreshDataLayer();
                const assignResult = await deliveryContainer.assignmentEngine.assignOrder(orderId);
                if (assignResult.success && assignResult.order) {
                    updatedOrder = assignResult.order.toJSON
                        ? assignResult.order.toJSON()
                        : assignResult.order;
                    if (assignResult.strategyUsed === 'AlreadyAssigned') {
                        assignmentMessage = ' The order already has an assigned rider.';
                    } else {
                        notificationEvent = 'Assigned';
                        notificationMobile = assignResult.rider?.mobile || updatedOrder.rider?.riderMobile;
                        assignmentMessage = ` Rider ${assignResult.rider.name} was assigned automatically.`;
                    }
                } else {
                    assignmentMessage = ' No available rider was found; assign one manually.';
                }
            } catch (assignmentError) {
                console.error('[AutoAssign] Assignment failed after order status changed:', assignmentError);
                assignmentMessage = ' Automatic assignment failed; assign a rider manually.';
            }
        }

        if (notificationEvent === 'Assigned') {
            const statusEvent = toOrderEventType(newStatus);
            if (statusEvent) {
                await publishOrderEvent(updatedOrder, statusEvent, { payload: { notificationSuppressed: true } });
            }
            await publishOrderEvent(updatedOrder, 'OrderAssigned', { payload: { riderMobile: notificationMobile } });
        } else if (notificationEvent === 'Ready to Dispatch') {
            await publishOrderEvent(updatedOrder, 'OrderReadyForDispatch');
        } else {
            const statusEvent = toOrderEventType(newStatus);
            if (statusEvent) await publishOrderEvent(updatedOrder, statusEvent);
        }

        res.json({
            message: `Order transitioned to ${newStatus}.${assignmentMessage}`,
            order: updatedOrder,
            deliveryRewards: updatedOrder.deliveryRewards || null
        });
    } catch (err) {
        console.error("Transition error:", err);
        res.status(400).json({ message: err.message || "State transition failed" });
    }
});

// Smart Delivery Route Clubbing & Google Maps link generation (Requirements 11, 12, 13, 14)
router.post('/admin/optimize-and-club-routes', authenticateUser, isAdmin, async (req, res) => {
    try {
        if (!getIsConnected()) {
            return res.status(503).json({ message: 'Route planning requires an active MongoDB connection.' });
        }
        deliveryContainer.refreshDataLayer();
        const { riderId, maxRadiusKm, startLat, startLng } = req.body;
        if (!riderId) return res.status(400).json({ message: 'Select an onboarded rider before planning a route.' });
        const rider = await deliveryContainer.riderRepository.findById(riderId);
        if (!rider || !rider.enabled) {
            return res.status(404).json({ message: 'The selected onboarded rider is unavailable.' });
        }
        if (rider.status !== 'Available') {
            return res.status(409).json({ message: 'The selected rider is no longer available.' });
        }
        const result = await dataStore.clubDeliveryRoute(
            rider.name,
            rider.mobile,
            maxRadiusKm,
            Number(startLat) || 12.9716,
            Number(startLng) || 77.5946
        );

        res.json({ ...result, riderId: rider.id });
    } catch (e) {
        console.error("Routing optimization error:", e);
        res.status(getErrorStatus(e)).json({ message: "Routing optimization failed: " + e.message });
    }
});

// Dispatch batch of clubbed orders to rider
router.post('/admin/dispatch-batch', authenticateUser, isAdmin, async (req, res) => {
    try {
        if (!getIsConnected()) {
            return res.status(503).json({ message: 'Batch dispatch requires an active MongoDB connection.' });
        }
        deliveryContainer.refreshDataLayer();
        const { orderIds, riderId } = req.body;
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ message: "No order IDs provided for dispatch." });
        }
        const riderInfo = await resolveDispatchRider(riderId);

        const actor = req.user.user_metadata?.name || req.user.email || 'Logistics Admin';

        const dispatchedOrders = [];
        const dispatchErrors = [];
        for (const id of orderIds) {
            try {
                const updated = await dataStore.transitionOrderStatus(id, 'Dispatched', actor, riderInfo);
                dispatchedOrders.push(updated);
                await publishOrderEvent(updated, 'OrderDispatched');
                await publishOrderEvent(updated, 'OrderInventoryDeducted');
            } catch (err) {
                console.warn(`Could not dispatch order ${id}:`, err.message);
                dispatchErrors.push({ orderId: id, message: err.message });
            }
        }

        res.json({
            message: `Successfully assigned and dispatched ${dispatchedOrders.length} orders to ${riderInfo.riderName}.`,
            dispatchedOrders,
            dispatchErrors
        });
    } catch (err) {
        res.status(getErrorStatus(err)).json({ message: "Batch dispatch failed: " + err.message });
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

        let riderInfo = null;
        if (targetStatus === 'Dispatched') {
            deliveryContainer.refreshDataLayer();
            const currentOrder = await deliveryContainer.orderRepository.findById(orderId);
            riderInfo = await resolveDispatchRider(currentOrder?.rider?.riderId, orderId);
        }
        let order = await dataStore.transitionOrderStatus(orderId, targetStatus, actor, riderInfo);
        if (targetStatus === 'Dispatched') await publishOrderEvent(order, 'OrderInventoryDeducted');
        if (targetStatus === 'Cancelled') await publishOrderEvent(order, 'OrderInventoryReleased');
        let assignmentMessage = '';
        let notificationEvent = step === 'ready' ? 'Ready to Dispatch' : null;
        if (step === 'ready') {
            try {
                deliveryContainer.refreshDataLayer();
                const result = await deliveryContainer.assignmentEngine.assignOrder(orderId);
                if (result.success) {
                    order = result.order.toJSON ? result.order.toJSON() : result.order;
                    notificationEvent = 'Assigned';
                    assignmentMessage = ` Rider ${result.rider.name} was assigned automatically.`;
                } else {
                    assignmentMessage = ' No available rider was found; assign one manually.';
                }
            } catch (assignmentError) {
                console.error(`[AutoAssign] Assignment failed for ready order ${orderId}:`, assignmentError);
                assignmentMessage = ' Automatic assignment failed; assign a rider manually.';
            }
        }
        if (step === 'dispatch') notificationEvent = 'Dispatched';
        else if (step === 'deliver') notificationEvent = 'Delivered';
        if (notificationEvent) {
            const event = notificationEvent === 'Dispatched'
                ? 'OrderDispatched'
                : notificationEvent === 'Delivered'
                    ? 'OrderDelivered'
                    : 'OrderReadyForDispatch';
            if (notificationEvent === 'Assigned') {
                await publishOrderEvent(order, 'OrderReadyForDispatch', { payload: { notificationSuppressed: true } });
                await publishOrderEvent(order, 'OrderAssigned');
            } else {
                await publishOrderEvent(order, event);
            }
        } else {
            const orderEvent = toOrderEventType(targetStatus);
            if (orderEvent) await publishOrderEvent(order, orderEvent);
        }

        res.json({ message: `Transaction status shifted safely.${assignmentMessage}`, order });
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
router.post('/:id/rating', authenticateUser, async (req, res) => {
    try {
        if (req.user?.app_metadata?.role === 'admin') {
            return res.status(403).json({ message: 'Only the customer can rate this delivery.' });
        }
        const rating = Number(req.body?.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Rating must be a whole number from 1 to 5.' });
        }
        const order = await dataStore.saveCustomerRating(
            req.params.id,
            req.user.sub,
            rating,
            String(req.body?.comment || '').trim().slice(0, 1000)
        );
        res.json({ message: 'Thank you for your feedback.', order });
    } catch (error) {
        console.error('Customer rating save failed:', error);
        res.status(getErrorStatus(error)).json({ message: error.message || 'Could not save your rating.' });
    }
});

router.get('/mine', authenticateUser, async (req, res) => {
    try {
        const orders = await dataStore.getUserOrders(req.user.sub);
        res.json(orders);
    } catch (err) {
        console.error('Customer order retrieval failed:', err);
        res.status(500).json({ message: 'Failed to retrieve orders.' });
    }
});

router.get('/history', authenticateUser, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ message: 'Order history is temporarily unavailable.' });
    }
    if (req.query.userId && req.query.userId !== req.user.sub) {
        return res.status(403).json({ message: 'You can only view your own order history.' });
    }

    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = 5;
        const closedStatuses = new Set(['completed', 'delivered', 'cancelled', 'rejected']);
        const statusFilter = {
            $or: [
                { orderStatus: { $in: [...closedStatuses].map(status => new RegExp(`^${status}$`, 'i')) } },
                { status: { $in: [...closedStatuses].map(status => new RegExp(`^${status}$`, 'i')) } }
            ]
        };
        const ownerFilter = { $or: [{ userId: req.user.sub }, { customerId: req.user.sub }] };
        const filter = { $and: [ownerFilter, statusFilter] };
        const total = await Order.countDocuments(filter);
        const totalPages = Math.ceil(total / limit);
        const currentPage = Math.min(page, Math.max(totalPages, 1));
        const orders = await Order.find(filter)
            .sort({ createdAt: -1 })
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .lean();
        res.status(200).json({
            orders,
            pagination: { page: currentPage, limit, total, totalPages }
        });
    } catch (err) {
        console.error('Order history retrieval failed:', err);
        res.status(500).json({ message: 'Failed to retrieve order history.' });
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
