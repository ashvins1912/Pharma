import express from 'express';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import Medicine from '../models/Medicine.js';
import Order from '../models/Order.js';
import { authenticateUser } from '../middleware/auth.js';
import { getIsConnected } from '../config/db.js';
import { publishOrderEvent } from '../services/OrderEventService.js';

const router = express.Router();
const allowedSources = new Set(['WEB', 'MOBILE', 'ADMIN', 'POS', 'ERP', 'PARTNER', 'API']);
const allowedStatuses = new Set([
    'Pending_Review', 'Approved', 'Rejected', 'Processing Order', 'Ready to Dispatch',
    'Dispatched', 'Delivered', 'Cancelled'
]);

const getErrorStatus = error => error.statusCode
    || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500);

export const serializeOrder = order => {
    const lines = order.items?.length ? order.items : (order.medicineItems || []);
    return {
        orderId: order.orderNumber,
        source: order.source || 'DIRECT',
        externalReference: order.externalReference || null,
        status: order.orderStatus || order.status,
        items: lines.map(item => ({
            productId: item.sku || null,
            sku: item.sku || null,
            name: item.productName || item.name || '',
            genericName: item.genericName || '',
            strength: item.strength || '',
            form: item.form || '',
            manufacturer: item.manufacturer || '',
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice ?? item.price ?? 0),
            tax: Number(item.tax || 0),
            discount: Number(item.discount || 0),
            totalPrice: Number(item.totalPrice ?? ((item.unitPrice ?? item.price ?? 0) * item.quantity)),
            snapshotAt: item.snapshotAt || order.createdAt
        })),
        subtotal: order.subtotal ?? order.totalAmount,
        discountApplied: order.discountApplied || 0,
        totalAmount: order.totalAmount,
        finalTotal: order.finalTotal ?? order.totalAmount,
        paymentMethod: order.paymentMethod,
        deliveryAddress: order.deliveryAddress,
        addressDetails: order.addressDetails || {},
        coordinates: order.coordinates,
        rider: order.rider || null,
        statusHistory: order.statusHistory || [],
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
    };
};

router.post('/', authenticateUser, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ message: 'Order Service is unavailable; no order was created.' });
    }
    let requestIdentity;
    let requestedItems;
    let normalizedSource;
    let normalizedExternalReference;
    let normalizedIdempotencyKey;
    try {
        const body = req.body || {};
        const source = body.source || 'API';
        const externalReference = typeof body.externalReference === 'string' ? body.externalReference.trim() : '';
        const idempotencyKey = (req.get('idempotency-key') || body.idempotencyKey || '').trim();
        normalizedSource = source;
        normalizedExternalReference = externalReference || null;
        normalizedIdempotencyKey = idempotencyKey || null;
        if (!allowedSources.has(source)) {
            return res.status(400).json({ message: 'source must identify a supported order channel.' });
        }
        if (!externalReference && !idempotencyKey) {
            return res.status(400).json({ message: 'Provide an externalReference or Idempotency-Key.' });
        }
        if (externalReference.length > 200 || idempotencyKey.length > 200) {
            return res.status(400).json({ message: 'Order idempotency values must not exceed 200 characters.' });
        }
        if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100
            || body.items.some(item => !item || typeof item !== 'object'
                || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1
                || !String(item.productId || item.sku || '').trim())) {
            return res.status(400).json({ message: 'items must contain 1 to 100 product IDs or SKUs with positive integer quantities.' });
        }
        if (typeof body.deliveryAddress !== 'string' || !body.deliveryAddress.trim()) {
            return res.status(400).json({ message: 'deliveryAddress is required.' });
        }
        const requestedPoints = Number(body.pointsToRedeem || 0);
        if (!Number.isSafeInteger(requestedPoints) || requestedPoints < 0) {
            return res.status(400).json({ message: 'pointsToRedeem must be a non-negative integer.' });
        }

        const productReferences = body.items.map(item => String(item.productId || item.sku).trim());
        const objectIds = productReferences.filter(mongoose.isValidObjectId);
        const products = await Medicine.find({
            $or: [
                { sku: { $in: productReferences.map(id => id.toUpperCase()) } },
                { code: { $in: productReferences.map(id => id.toUpperCase()) } },
                ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])
            ]
        }).lean();
        const productsById = new Map(products.map(product => [String(product._id), product]));
        const productsBySku = new Map(products.flatMap(product => [
            [String(product.sku || '').toUpperCase(), product],
            [String(product.code || '').toUpperCase(), product]
        ]).filter(([sku]) => sku));
        const resolvedItems = [];
        for (let index = 0; index < body.items.length; index += 1) {
            const productReference = productReferences[index];
            const product = productsById.get(productReference) || productsBySku.get(productReference.toUpperCase());
            if (!product) return res.status(409).json({ message: `Product ${productReference} is unavailable.` });
            resolvedItems.push({ medicineId: String(product._id), quantity: Number(body.items[index].quantity) });
        }

        const lookup = {
            userId: req.user.sub,
            source,
            $or: [
                ...(externalReference ? [{ externalReference }] : []),
                ...(idempotencyKey ? [{ idempotencyKey }] : [])
            ]
        };
        requestIdentity = lookup;
        requestedItems = new Map();
        for (const item of resolvedItems) {
            requestedItems.set(item.medicineId, (requestedItems.get(item.medicineId) || 0) + item.quantity);
        }
        const existing = await Order.findOne(lookup).lean();
        if (existing) {
            const priorItems = new Map((existing.medicineItems || []).map(item => [
                String(item.medicineId),
                Number(item.quantity)
            ]));
            if (requestedItems.size !== priorItems.size
                || [...requestedItems].some(([id, quantity]) => priorItems.get(id) !== quantity)
                || (externalReference && existing.externalReference !== externalReference)
                || (idempotencyKey && existing.idempotencyKey !== idempotencyKey)) {
                return res.status(409).json({ message: 'Order idempotency reference was reused with different items.' });
            }
            return res.status(200).json({ order: serializeOrder(existing), replayed: true });
        }

        const order = await dataStore.reserveOrder({
            userId: req.user.sub,
            customerName: body.addressDetails?.fullName || req.user.user_metadata?.name || req.user.email || 'Customer',
            customerMobile: String(body.mobile || body.addressDetails?.mobile || body.addressDetails?.phone || req.user.user_metadata?.mobile || '').trim(),
            items: resolvedItems,
            deliveryAddress: body.deliveryAddress.trim(),
            addressDetails: body.addressDetails || {},
            coordinates: body.coordinates,
            paymentMethod: body.paymentMethod || 'Cash on Delivery (COD)',
            couponCode: body.couponCode,
            pointsToRedeem: requestedPoints,
            prescriptionUrl: body.prescriptionUrl || null,
            source,
            externalReference: externalReference || null,
            idempotencyKey: idempotencyKey || null
        }, req.user.email || 'API Client');

        await publishOrderEvent(order, 'OrderCreated');
        await publishOrderEvent(order, 'OrderInventoryReserved');
        return res.status(201).json({ order: serializeOrder(order), replayed: false });
    } catch (error) {
        if (error.code === 11000 && getIsConnected()) {
            const existing = requestIdentity ? await Order.findOne(requestIdentity).lean() : null;
            if (existing && requestedItems) {
                const priorItems = new Map((existing.medicineItems || []).map(item => [
                    String(item.medicineId),
                    Number(item.quantity)
                ]));
                if (existing.source === normalizedSource
                    && existing.externalReference === normalizedExternalReference
                    && existing.idempotencyKey === normalizedIdempotencyKey
                    && requestedItems.size === priorItems.size
                    && [...requestedItems].every(([id, quantity]) => priorItems.get(id) === quantity)) {
                    return res.status(200).json({ order: serializeOrder(existing), replayed: true });
                }
                return res.status(409).json({ message: 'Order idempotency reference was reused for a different order.' });
            }
            return res.status(409).json({ message: 'Order idempotency reference is already in use.' });
        }
        console.error('Versioned order creation failed:', error);
        return res.status(getErrorStatus(error)).json({ message: error.message || 'Could not create order.' });
    }
});

router.get('/', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Orders are temporarily unavailable.' });
    try {
        const query = {};
        const admin = req.user?.app_metadata?.role === 'admin' || req.user?.role === 'admin';
        if (admin) {
            if (req.query.source) query.source = req.query.source;
            if (req.query.customerId) query.customerId = req.query.customerId;
        } else {
            query.userId = req.user.sub;
        }
        if (req.query.status) {
            if (!allowedStatuses.has(req.query.status)) {
                return res.status(400).json({ message: 'status is not supported.' });
            }
            query.orderStatus = req.query.status;
        }
        const from = req.query.from ? new Date(req.query.from) : null;
        const to = req.query.to ? new Date(req.query.to) : null;
        if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
            return res.status(400).json({ message: 'from and to must be valid dates.' });
        }
        if (from || to) {
            query.createdAt = {
                ...(from ? { $gte: from } : {}),
                ...(to ? { $lte: to } : {})
            };
        }
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
        const [orders, total] = await Promise.all([
            Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Order.countDocuments(query)
        ]);
        return res.json({ orders: orders.map(serializeOrder), page, limit, total });
    } catch (error) {
        console.error('Versioned order retrieval failed:', error);
        return res.status(500).json({ message: 'Could not fetch orders.' });
    }
});

router.get('/:id', authenticateUser, async (req, res) => {
    try {
        const order = getIsConnected()
            ? await Order.findOne({ orderNumber: req.params.id }).lean()
            : await dataStore.getOrder(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order was not found.' });
        const admin = req.user?.app_metadata?.role === 'admin' || req.user?.role === 'admin';
        if (!admin && order.userId !== req.user.sub && order.customerId !== req.user.sub) {
            return res.status(404).json({ message: 'Order was not found.' });
        }
        return res.json({ order: serializeOrder(order) });
    } catch (error) {
        console.error('Versioned order retrieval failed:', error);
        return res.status(500).json({ message: 'Could not fetch order.' });
    }
});

export default router;
