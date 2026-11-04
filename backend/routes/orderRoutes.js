import express from 'express';
import { createHash, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import Order from '../models/Order.js';
import Tenant from '../models/Tenant.js';
import TenantBranch from '../models/TenantBranch.js';
import Rider from '../models/Rider.js';
import Medicine from '../models/Medicine.js';
import FulfillmentCase from '../models/FulfillmentCase.js';
import MedicineRequest from '../models/MedicineRequest.js';
import { buildIntelligentFulfillmentPlan, validateWaitWindow } from '../services/intelligentFulfillment/fulfillmentPlanner.js';
import { refreshStockWaitlistCases } from '../services/intelligentFulfillment/waitlistMonitor.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';
import { sendCustomWhatsAppAlert, getNotificationLog } from '../config/whatsapp.js';
import { getPrescription, removePrescription, savePrescription } from '../config/prescriptionStorage.js';
import { getIsConnected } from '../config/db.js';
import { cacheService } from '../services/cache/CacheService.js';
import DynamicOrderService from '../services/DynamicOrderService.js';
import deliveryContainer from '../modules/delivery/container.js';
import { classifyOrderSearch, paginationResult } from '../services/orderSearch.js';
import { verifyPrescriptionAgainstItems } from '../services/prescription-verification/PrescriptionVerificationService.js';
import prescriptionClient from '../services/prescription-service-client/PrescriptionClient.js';
import { reinitiatePrescriptionProcessing } from '../../services/order-service/src/prescription-client.js';
import { customerService } from '../services/customer-service/CustomerService.js';
import { domainEvents } from '../shared/events/DomainEvents.js';
import { isSameTenant } from '../authorization/tenantScope.js';
import { isAssignedRiderForOrder } from '../authorization/deliveryScope.js';

const router = express.Router();

const TENANT_STAFF_ROLES = new Set([
    'TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF',
    'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN', 'PHARMACY'
]);
const getActorRole = req => String(req.user?.role || req.user?.app_metadata?.role || req.context?.role || '').toUpperCase();
const getActorTenantId = req => req.user?.tenantId || req.user?.app_metadata?.tenantId || req.context?.tenantId || null;
const isPlatformOrderAdmin = req => ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(getActorRole(req));
const isTenantOrderStaff = req => TENANT_STAFF_ROLES.has(getActorRole(req));
const canTenantAccessOrder = (req, order) => {
    if (isPlatformOrderAdmin(req)) return true;
    if (isTenantOrderStaff(req)) {
        const tenantId = getActorTenantId(req);
        return isSameTenant(tenantId, order?.tenantId);
    }
    const ownerIds = [order?.userId, order?.customerId].filter(Boolean).map(String);
    return ownerIds.includes(String(req.user?.sub || ''));
};

const sanitizeTenantRiderReferences = async orders => {
    const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean);
    if (!list.length) return Array.isArray(orders) ? list : orders;
    const grouped = new Map();
    for (const order of list) {
        const tenantId = String(order.tenantId || '');
        const riderId = String(order.rider?.riderId || order.riderId || order.assignedRiderId || '');
        if (!tenantId || !riderId || !mongoose.isValidObjectId(riderId)) continue;
        if (!grouped.has(tenantId)) grouped.set(tenantId, new Set());
        grouped.get(tenantId).add(riderId);
    }
    const valid = new Set();
    try {
        for (const [tenantId, riderIds] of grouped.entries()) {
            const rows = await Rider.find({ tenantId, _id: { $in: [...riderIds] } }).select('_id').lean();
            for (const row of rows) valid.add(`${tenantId}:${String(row._id)}`);
        }
    } catch (error) {
        console.warn('[OrderRoutes] Could not verify rider tenant ownership; stripping rider details:', error.message);
    }
    for (const order of list) {
        const riderId = String(order.rider?.riderId || order.riderId || order.assignedRiderId || '');
        const key = `${String(order.tenantId || '')}:${riderId}`;
        if (!riderId || !valid.has(key)) {
            order.rider = null;
            order.riderId = null;
            order.assignedRiderId = null;
            order.deliveryPersonMobile = null;
            order.deliveryPersonName = null;
            order.riderMobile = null;
            order.riderName = null;
        }
    }
    return Array.isArray(orders) ? list : list[0];
};

const tenantOrderIdGuard = async (req, res, next) => {
    if (!isTenantOrderStaff(req)) return next();
    const orderId = req.params.id;
    if (!getActorTenantId(req) || !mongoose.isValidObjectId(orderId)) return res.status(404).json({ message: 'Order not found.' });
    try {
        const order = await Order.findById(orderId).select('_id tenantId').lean();
        if (!order || !canTenantAccessOrder(req, order)) return res.status(404).json({ message: 'Order not found.' });
        return next();
    } catch {
        return res.status(503).json({ message: 'Tenant-scoped order authorization is temporarily unavailable.' });
    }
};
router.use('/:id', (req, res, next) => {
    const reserved = new Set(['admin', 'mine', 'history', 'checkout', 'dynamic-restock', 'prescriptions', 'notifications', 'fulfillment', 'all']);
    if (reserved.has(String(req.params.id || '').toLowerCase())) return next();
    return tenantOrderIdGuard(req, res, next);
});
router.use('/admin/:id', (req, res, next) => {
    const reserved = new Set(['all', 'transition', 'dispatch-batch', 'optimize-and-club-routes', 'medicine-requests', 'riders', 'assignment', 'whatsapp']);
    if (reserved.has(String(req.params.id || '').toLowerCase())) return next();
    return tenantOrderIdGuard(req, res, next);
});
const dynamicOrderService = new DynamicOrderService({
    couponValidator: (code, subtotal, context) => dataStore.validateCoupon(code, subtotal, context)
});
const getErrorStatus = (error) => {
    if (error.statusCode) return error.statusCode;
    if (['CastError', 'ValidationError'].includes(error.name)) return 400;
    if (['MongoServerError', 'MongoNetworkError', 'MongooseError', 'MongoServerSelectionError', 'MongoTopologyClosedError', 'MongoNetworkTimeoutError'].includes(error.name)) return 503;
    return 500;
};
const resolveDispatchRider = async (riderId, orderId = null, tenantId) => {
    if (!getIsConnected()) {
        throw Object.assign(new Error('Dispatch requires an active MongoDB connection.'), { statusCode: 503 });
    }
    if (!riderId) {
        throw Object.assign(new Error('Select an onboarded rider before dispatching.'), { statusCode: 400 });
    }
    deliveryContainer.refreshDataLayer();
    if (!tenantId) throw Object.assign(new Error('The order tenant is required to select a delivery rider.'), { statusCode: 403 });
    const rider = await deliveryContainer.riderRepository.findById(riderId, tenantId);
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
const allowedPrescriptionTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/x-ms-bmp']);
const normalizedOrderStatuses = ['pending', 'accepted', 'out_for_delivery', 'delivered', 'cancelled'];
const uploadPrescription = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        if (!(allowedPrescriptionTypes.has(file.mimetype) || file.mimetype.startsWith('image/'))) {
            return callback(new Error('Prescription must be a PDF or image file.'));
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
    let coords = coordinates;
    if (typeof coords === 'string') {
        try { coords = JSON.parse(coords); } catch { return false; }
    }
    if (coords?.lat == null || coords?.lng == null
        || String(coords.lat).trim() === '' || String(coords.lng).trim() === '') return false;
    const lat = Number(coords?.lat);
    const lng = Number(coords?.lng);
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
    // Other image formats are decoded and validated by the Prescription Service converter.
    return file.mimetype.startsWith('image/');
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

router.post('/', authenticateUser, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ error: 'MongoDB is unavailable. Order was not created.' });
    }
    try {
        const items = req.body?.items || req.body?.cartItems;
        if (!Array.isArray(items) || items.length === 0 || items.some(item =>
            !item || typeof item !== 'object' || Array.isArray(item)
            || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1
        )) {
            return res.status(400).json({ error: 'Order items must be a non-empty list with a positive whole-number quantity per item.' });
        }
        const selectedTenantId = String(req.body?.tenantId || '').trim();
        if (!selectedTenantId) return res.status(400).json({ code: 'PHARMACY_SELECTION_REQUIRED', message: 'Select a pharmacy before placing an order.' });
        const selectedTenant = await Tenant.findOne({ _id: selectedTenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!selectedTenant) return res.status(404).json({ code: 'PHARMACY_UNAVAILABLE', message: 'The selected pharmacy is not available.' });
        const medicineIds = [...new Set(items.map(item => String(item.medicineId || item.productId || item._id || item.id || '')).filter(Boolean))];
        if (medicineIds.length === 0 || medicineIds.some(id => !mongoose.isValidObjectId(id))) {
            return res.status(400).json({ message: 'Every order item must reference a valid medicine in the selected pharmacy catalogue.' });
        }
        const medicines = await Medicine.find({
            _id: { $in: medicineIds },
            tenantId: selectedTenantId,
            isActive: { $ne: false }
        }).select('_id name price sku').lean();
        if (medicines.length !== medicineIds.length) {
            return res.status(404).json({ code: 'MEDICINE_NOT_IN_SELECTED_PHARMACY', message: 'One or more medicines are not available from the selected pharmacy.' });
        }
        const medicineById = new Map(medicines.map(medicine => [String(medicine._id), medicine]));
        const scopedItems = items.map(item => {
            const medicineId = String(item.medicineId || item.productId || item._id || item.id);
            const medicine = medicineById.get(medicineId);
            return { ...item, medicineId, productId: medicineId, name: medicine.name, price: Number(medicine.price), unitPrice: Number(medicine.price), sku: medicine.sku || item.sku || '' };
        });
        let deliveryAddress = typeof req.body.deliveryAddress === 'string' ? req.body.deliveryAddress.trim() : '';
        let coordinates = req.body.coordinates;
        let addressSnapshot = null;
        if (req.body.addressId) {
            // Resolve the saved address only for the authenticated owner; use its
            // contact details as the trusted delivery snapshot.
            addressSnapshot = await dataStore.getUserAddress(req.user.sub, req.body.addressId);
            if (addressSnapshot) {
                deliveryAddress = deliveryAddress || addressSnapshot.addressLine
                    || [addressSnapshot.addressLine1, addressSnapshot.city && `${addressSnapshot.city} - ${addressSnapshot.pincode || ''}`].filter(Boolean).join(', ');
                coordinates = coordinates || addressSnapshot.coordinates;
            } else if (!deliveryAddress) {
                return res.status(400).json({ error: 'The selected delivery address was not found.' });
            }
        }
        if (!deliveryAddress) {
            return res.status(400).json({ error: 'A deliveryAddress is required for an order.' });
        }
        const addressDetails = {
            ...(addressSnapshot || {}),
            ...(req.body.addressDetails || {}),
            mobile: addressSnapshot?.mobile || req.body.addressDetails?.mobile || req.body.addressDetails?.phone || ''
        };
        const customerMobile = String(
            addressSnapshot?.mobile
            || req.body.mobile
            || req.body.addressDetails?.mobile
            || req.body.addressDetails?.phone
            || req.user.user_metadata?.mobile
            || ''
        ).trim();
        if (!hasValidCoordinates(coordinates)) {
            return res.status(400).json({ code: 'DELIVERY_PIN_REQUIRED', message: 'A confirmed delivery map pin is required to place an order.' });
        }
        const order = await dataStore.reserveOrder({
            userId: req.user.sub,
            customerId: req.user.sub,
            tenantId: selectedTenantId,
            addressId: addressSnapshot?._id || req.body.addressId || null,
            customerName: addressSnapshot?.fullName || req.user.user_metadata?.name || req.user.email || 'Customer',
            customerMobile,
            items: scopedItems,
            deliveryAddress,
            addressDetails,
            coordinates,
            paymentMethod: req.body.paymentMethod || 'Cash on Delivery (COD)',
            couponCode: req.body.couponCode || '',
            pointsToRedeem: Number(req.body.pointsToRedeem || 0)
        }, req.user.user_metadata?.name || req.user.email || 'Customer');

        return res.status(201).json({ order });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ code: error.code || 'ORDER_CHECKOUT_FAILED', error: error.message, message: error.message });
        }
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Order creation failed:', error);
        return res.status(500).json({ error: 'Could not create order.' });
    }
});

router.get('/', authenticateUser, async (req, res) => {
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
        const isAdminUser = isPlatformOrderAdmin(req);
        const tenantStaff = isTenantOrderStaff(req);
        const query = {};
        if (status) query.status = status;
        if (tenantStaff) {
            const tenantId = getActorTenantId(req);
            if (!tenantId) return res.status(403).json({ error: 'An active tenant context is required to view fulfillment orders.' });
            query.tenantId = String(tenantId);
        }
        if (isAdminUser) {
            if (customerId) query.customerId = customerId;
            if (riderId) query.$or = [{ riderId }, { 'rider.riderId': String(riderId) }];
        } else if (tenantStaff) {
            if (riderId) query.$or = [{ riderId }, { 'rider.riderId': String(riderId) }];
        } else if (riderId) {
            const rider = await Rider.findOne({ supabaseId: req.user.sub, _id: riderId, enabled: true }).select('_id tenantId').lean();
            if (!rider) return res.status(403).json({ error: 'You can only fetch orders assigned to your rider profile.' });
            query.tenantId = String(rider.tenantId);
            query.$or = [{ riderId: rider._id }, { 'rider.riderId': String(rider._id) }];
        } else {
            query.$or = [{ customerId: req.user.sub }, { userId: req.user.sub }];
        }
        const orders = await Order.find(query).sort({ createdAt: -1 }).lean();
        if (!isPlatformOrderAdmin(req)) await sanitizeTenantRiderReferences(orders);
        return res.json({ orders });
    } catch (error) {
        console.error('Order retrieval failed:', error);
        return res.status(500).json({ error: 'Could not fetch orders.' });
    }
});


/**
 * Availability is advisory only. The final checkout reservation remains the
 * atomic source of truth; preview never holds stock or promises availability.
 */
router.post('/fulfillment/preview', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Live inventory is temporarily unavailable.' });
    try {
        const tenantId = String(req.body?.tenantId || '').trim();
        if (!tenantId) return res.status(400).json({ code: 'PHARMACY_SELECTION_REQUIRED', message: 'Select a pharmacy first.' });
        const items = parseCheckoutItems(req.body?.items || req.body?.cartItems);
        if (!Array.isArray(items) || !items.length) return res.status(400).json({ message: 'Add at least one medicine.' });
        const ids = [...new Set(items.map(item => String(item.medicineId || item._id || item.id || '')).filter(Boolean))];
        if (ids.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'One or more cart products are invalid.' });
        const tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!tenant) return res.status(404).json({ message: 'Selected pharmacy is unavailable.' });
        const branchId = String(req.body?.branchId || req.user?.branchId || req.user?.app_metadata?.branchId || '').trim();
        if (branchId) {
            const branch = await TenantBranch.findOne({ _id: branchId, tenantId, status: 'ACTIVE' }).select('_id').lean();
            if (!branch) return res.status(404).json({ message: 'Selected pharmacy branch is unavailable.' });
        }
        const branchScope = branchId ? { branchId } : {};
        const inventory = await Medicine.find({ _id: { $in: ids }, tenantId, ...branchScope }).select('_id name sku code price basePrice stockQuantity stock quantity reservedQuantity expiryDate isActive composition genericName strength dosageForm form requiresPrescription isPrescriptionRequired discountPercentage manufacturer brand').lean();
        const compositionKeys = [...new Set([...inventory.map(item => item.composition || item.genericName), ...items.map(item => item.composition || item.genericName)].map(value => String(value || '').trim()).filter(value => value && !['active compound', 'unknown', 'n/a', 'na'].includes(value.toLowerCase())))];
        const strengthKeys = [...new Set([...inventory.map(item => item.strength), ...items.map(item => item.strength)].map(value => String(value || '').trim()).filter(Boolean))];
        const catalog = compositionKeys.length && strengthKeys.length
            ? await Medicine.find({
                tenantId, ...branchScope, isActive: { $ne: false },
                _id: { $nin: ids },
                composition: { $in: compositionKeys },
                strength: { $in: strengthKeys },
                expiryDate: { $gt: new Date() }
            }).limit(100).select('_id name sku code price stockQuantity stock quantity reservedQuantity expiryDate isActive composition genericName strength dosageForm form requiresPrescription isPrescriptionRequired discountPercentage manufacturer brand').lean()
            : [];
        const plan = buildIntelligentFulfillmentPlan({ requestedItems: items, inventory, catalog });
        return res.json({ ...plan, tenantId, branchId: branchId || null });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to calculate fulfilment options.' });
    }
});

router.get('/fulfillment/waitlist', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Stock waitlist is temporarily unavailable.' });
    try {
        const checkedAt = new Date();
        await refreshStockWaitlistCases({ limit: 50, customerId: String(req.user.sub), now: checkedAt });
        const cases = await FulfillmentCase.find({
            customerId: String(req.user.sub),
            status: { $in: ['AWAITING_CUSTOMER_DECISION', 'WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED', 'CONFIRMING'] }
        }).sort({ createdAt: -1 }).limit(50).lean();
        return res.json({ items: cases, checkedAt: checkedAt.toISOString() });
    } catch (error) {
        console.error('Stock waitlist refresh failed:', error);
        return res.status(503).json({ message: 'Unable to load and refresh your stock waitlist.' });
    }
});

router.post('/fulfillment/waitlist', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Stock waitlist is temporarily unavailable.' });
    let requestFingerprint = null;
    try {
        const tenantId = String(req.body?.tenantId || '').trim();
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (!tenantId || !items.length) return res.status(400).json({ message: 'Pharmacy and pending medicine items are required.' });
        if (!idempotencyKey || idempotencyKey.length > 128) return res.status(400).json({ message: 'A valid Idempotency-Key header is required.' });
        const { waitDays, waitUntil } = validateWaitWindow(req.body?.waitDays);
        const selectedBranchId = String(req.body?.branchId || req.user?.branchId || req.user?.app_metadata?.branchId || '').trim();
        const normalizedWaitItems = items.map(item => ({
            productId: String(item.productId || item.medicineId || ''),
            requestedName: String(item.requestedName || item.name || '').trim(),
            composition: String(item.composition || '').trim(), strength: String(item.strength || '').trim(),
            dosageForm: String(item.dosageForm || '').trim(),
            requestedQuantity: Number(item.requestedQuantity ?? item.waitingQuantity)
        })).sort((a, b) => a.productId.localeCompare(b.productId) || a.requestedName.localeCompare(b.requestedName));
        requestFingerprint = createHash('sha256').update(JSON.stringify({ tenantId, branchId: selectedBranchId, sourceType: req.body?.sourceType || 'CHECKOUT', sourceId: req.body?.sourceId || null, parentOrderId: req.body?.parentOrderId || null, waitDays, items: normalizedWaitItems })).digest('hex');
        const ids = [...new Set(items.map(item => String(item.productId || item.medicineId || '')).filter(Boolean))];
        if (!items.every(item => {
            const productId = String(item.productId || item.medicineId || '');
            const requestedName = String(item.requestedName || item.name || '').trim();
            const requestedQuantity = Number(item.requestedQuantity ?? item.waitingQuantity);
            return (productId ? mongoose.isValidObjectId(productId) : requestedName.length > 1)
                && Number.isSafeInteger(requestedQuantity) && requestedQuantity > 0;
        })) return res.status(400).json({ message: 'Each waitlist item needs a catalogue product or requested medicine name and a positive whole-number quantity.' });
        const tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!tenant) return res.status(404).json({ message: 'Selected pharmacy is unavailable.' });
        if (selectedBranchId) {
            const branch = await TenantBranch.findOne({ _id: selectedBranchId, tenantId, status: 'ACTIVE' }).select('_id').lean();
            if (!branch) return res.status(404).json({ message: 'Selected pharmacy branch is unavailable.' });
        }
        const existing = await FulfillmentCase.findOne({ customerId: String(req.user.sub), tenantId, idempotencyKey }).lean();
        if (existing) {
            if (existing.requestFingerprint !== requestFingerprint) return res.status(409).json({ message: 'This idempotency key was already used for a different waitlist request.' });
            return res.status(200).json({ case: existing, alreadyCreated: true });
        }
        const inventory = ids.length ? await Medicine.find({ _id: { $in: ids }, tenantId, ...(selectedBranchId ? { branchId: selectedBranchId } : {}) }).select('_id name').lean() : [];
        if (inventory.length !== ids.length) return res.status(404).json({ message: 'One or more selected medicines are not listed by this pharmacy.' });
        const lines = items.map(item => {
            const productId = String(item.productId || item.medicineId || '');
            const requestedQuantity = Number(item.requestedQuantity ?? item.waitingQuantity);
            const product = productId ? inventory.find(row => String(row._id) === productId) : null;
            return {
                productId: productId || null,
                name: product?.name || String(item.requestedName || item.name || '').trim(),
                requestedName: String(item.requestedName || item.name || product?.name || '').trim(),
                composition: String(item.composition || '').trim(),
                strength: String(item.strength || '').trim(),
                dosageForm: String(item.dosageForm || '').trim(),
                requestedQuantity,
                allocatedQuantity: 0, waitingQuantity: requestedQuantity,
                customerDecision: 'ACCEPTED_ORIGINAL'
            };
        });
        const caseNumber = 'FUL-' + randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
        const created = await FulfillmentCase.create({
            caseNumber, customerId: String(req.user.sub), tenantId,
            branchId: selectedBranchId || null,
            sourceType: req.body?.sourceType === 'MEDICINE_REQUEST' ? 'MEDICINE_REQUEST' : 'CHECKOUT',
            sourceId: req.body?.sourceId ? String(req.body.sourceId) : null,
            parentOrderId: req.body?.parentOrderId ? String(req.body.parentOrderId) : null,
            addressId: req.body?.addressId || null,
            deliveryAddress: String(req.body?.deliveryAddress || '').trim(),
            addressDetails: req.body?.addressDetails || {},
            coordinates: req.body?.coordinates || null,
            customerMobile: String(req.body?.customerMobile || req.body?.mobile || '').trim(),
            orderedForName: String(req.body?.orderedForName || '').trim(),
            prescriptionRequired: Boolean(req.body?.prescriptionRequired),
            paymentMethod: req.body?.paymentMethod || 'Cash on Delivery (COD)',
            prescriptionUrl: req.body?.prescriptionUrl || null,
            prescriptionId: req.body?.prescriptionId || null,
            patientPuid: req.body?.patientPuid || null,
            status: 'WAITING_FOR_STOCK', lines, waitDays, waitUntil,
            idempotencyKey, requestFingerprint,
            auditTrail: [{ action: 'WAITLIST_CREATED', actorId: String(req.user.sub), at: new Date(), waitDays, waitUntil }]
        });
        if (created.parentOrderId) {
            await Order.updateOne({ _id: created.parentOrderId, userId: String(req.user.sub), tenantId }, { $set: { fulfillmentCaseId: String(created._id), fulfillmentState: 'PARTIAL' } });
        }
        return res.status(201).json({ case: created.toObject(), message: 'Your stock waitlist request has been saved.' });
    } catch (error) {
        if (error.code === 11000) {
            const existing = await FulfillmentCase.findOne({ customerId: String(req.user.sub), tenantId: String(req.body?.tenantId || ''), idempotencyKey: String(req.get('Idempotency-Key') || '') }).lean();
            if (existing && existing.requestFingerprint === requestFingerprint) return res.status(200).json({ case: existing, alreadyCreated: true });
        }
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to save stock waitlist request.' });
    }
});


router.post('/fulfillment/waitlist/:id/link-order', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Order linking is temporarily unavailable.' });
    try {
        const orderId = String(req.body?.orderId || '').trim();
        if (!mongoose.isValidObjectId(orderId)) return res.status(400).json({ message: 'A valid order ID is required.' });
        const entry = await FulfillmentCase.findOne({ _id: req.params.id, customerId: String(req.user.sub), status: { $in: ['WAITING_FOR_STOCK', 'PARTIALLY_FULFILLED', 'READY_FOR_CONFIRMATION'] } }).lean();
        if (!entry) return res.status(404).json({ message: 'Stock waitlist entry was not found.' });
        const order = await Order.findOne({
            _id: orderId,
            userId: String(req.user.sub),
            customerId: String(req.user.sub),
            tenantId: String(entry.tenantId)
        }).select('_id tenantId prescriptionUrl prescriptionId patientPuid customerMobile orderedForName').lean();
        if (!order) return res.status(404).json({ message: 'The order does not belong to this customer and pharmacy.' });
        const linked = await FulfillmentCase.findOneAndUpdate({
            _id: entry._id, customerId: String(req.user.sub),
            $or: [{ parentOrderId: null }, { parentOrderId: String(order._id) }]
        }, {
            $set: {
                parentOrderId: String(order._id),
                prescriptionUrl: order.prescriptionUrl || null,
                prescriptionId: order.prescriptionId || null,
                patientPuid: order.patientPuid || null,
                customerMobile: order.customerMobile || '',
                orderedForName: order.orderedForName || ''
            },
            $push: { auditTrail: { action: 'PARTIAL_ORDER_LINKED', actorId: String(req.user.sub), at: new Date(), orderId: String(order._id) } }
        }, { new: true }).lean();
        if (!linked) return res.status(409).json({ message: 'This waitlist is already linked to a different order.' });
        await Order.updateOne({ _id: order._id, userId: String(req.user.sub), tenantId: entry.tenantId }, {
            $set: { fulfillmentCaseId: String(entry._id), fulfillmentState: 'PARTIAL' }
        });
        return res.json({ case: linked, message: 'Pending items are linked to your partial order.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to link pending items to the order.' });
    }
});

router.post('/fulfillment/from-medicine-request/:id', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Medicine request stock matching is temporarily unavailable.' });
    try {
        const request = await dataStore.getMedicineRequestById(req.params.id, req.user);
        if (!request || String(request.customerId) !== String(req.user.sub)) {
            return res.status(404).json({ message: 'Medicine request not found.' });
        }
        if (!request.tenantId) return res.status(409).json({ message: 'Select a pharmacy for this medicine request before joining its stock waitlist.' });
        if (request.fulfillmentCaseId) {
            const existing = await FulfillmentCase.findOne({ _id: request.fulfillmentCaseId, customerId: String(req.user.sub), tenantId: String(request.tenantId) }).lean();
            if (existing) return res.status(200).json({ case: existing, alreadyCreated: true });
        }
        if (!['REQUESTED', 'UNDER_REVIEW', 'FULFILLMENT_PROCESSING', 'WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION'].includes(request.status)) {
            return res.status(409).json({ message: 'This medicine request cannot be added to a stock waitlist in its current status.' });
        }
        const { waitDays, waitUntil } = validateWaitWindow(req.body?.waitDays);
        const tenantId = String(request.tenantId);
        const tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!tenant) return res.status(404).json({ message: 'The selected pharmacy is unavailable.' });
        const branchId = request.branchId ? String(request.branchId) : null;
        if (branchId) {
            const branch = await TenantBranch.findOne({ _id: branchId, tenantId, status: 'ACTIVE' }).select('_id').lean();
            if (!branch) return res.status(404).json({ message: 'The selected pharmacy branch is unavailable.' });
        }
        const address = request.addressId ? await dataStore.getUserAddress(req.user.sub, request.addressId) : null;
        const deliveryAddress = String(request.deliveryAddress || address?.addressLine || '').trim();
        const coordinates = request.coordinates || address?.coordinates || null;
        if (!address || !deliveryAddress || !hasValidCoordinates(coordinates)) {
            return res.status(409).json({ message: 'Add and verify a delivery address with a map pin before waiting for stock.' });
        }
        const items = (request.requestedItems || []).map(item => {
            const rawId = String(item.productId || item.medicineId || '');
            const productId = mongoose.isValidObjectId(rawId) ? rawId : '';
            return {
                productId: productId || null,
                requestedName: String(item.requestedName || '').trim(),
                composition: String(item.composition || '').trim(),
                strength: String(item.strength || '').trim(),
                dosageForm: String(item.dosageForm || '').trim(),
                manufacturer: String(item.manufacturer || '').trim(),
                requestedQuantity: Number(item.quantity || 1)
            };
        });
        if (!items.length || items.some(item => (!item.productId && item.requestedName.length < 2) || !Number.isSafeInteger(item.requestedQuantity) || item.requestedQuantity < 1)) {
            return res.status(400).json({ message: 'The medicine request needs a valid medicine name and positive whole-number quantity for each item.' });
        }
        const idempotencyKey = `medicine-request:${String(request._id)}`;
        const requestFingerprint = createHash('sha256').update(JSON.stringify({ requestId: String(request._id), tenantId, waitDays, items })).digest('hex');
        const duplicate = await FulfillmentCase.findOne({ customerId: String(req.user.sub), tenantId, idempotencyKey }).lean();
        if (duplicate) return res.status(200).json({ case: duplicate, alreadyCreated: true });
        const caseNumber = 'FUL-' + randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
        const created = await FulfillmentCase.create({
            caseNumber, customerId: String(req.user.sub), tenantId, branchId,
            sourceType: 'MEDICINE_REQUEST', sourceId: String(request._id),
            addressId: address._id, deliveryAddress, addressDetails: address,
            coordinates, customerMobile: request.customerPhone || address.mobile || '',
            orderedForName: request.customerName || 'Customer',
            patientPuid: request.patientPuid || null,
            prescriptionRequired: Boolean(request.prescriptionId || request.prescriptionUrl),
            prescriptionUrl: request.prescriptionUrl || null,
            prescriptionId: request.prescriptionId || null,
            status: 'WAITING_FOR_STOCK', lines: items.map(item => ({
                productId: item.productId, name: item.requestedName, requestedName: item.requestedName,
                composition: item.composition, strength: item.strength, dosageForm: item.dosageForm,
                manufacturer: item.manufacturer, requestedQuantity: item.requestedQuantity,
                allocatedQuantity: 0, waitingQuantity: item.requestedQuantity,
                customerDecision: 'ACCEPTED_ORIGINAL'
            })),
            waitDays, waitUntil, idempotencyKey, requestFingerprint,
            auditTrail: [{ action: 'MEDICINE_REQUEST_WAITLIST_CREATED', actorId: String(req.user.sub), at: new Date(), waitDays, waitUntil }]
        });
        const updatedRequest = await MedicineRequest.findOneAndUpdate({
            _id: request._id, customerId: String(req.user.sub),
            fulfillmentCaseId: null, status: { $in: ['REQUESTED', 'UNDER_REVIEW', 'FULFILLMENT_PROCESSING', 'WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION'] }
        }, {
            $set: { fulfillmentCaseId: String(created._id), waitDays, waitUntil, status: 'WAITING_FOR_STOCK' },
            $push: { auditTrail: { action: 'STOCK_WAITLIST_CREATED', actorId: String(req.user.sub), role: 'Customer', timestamp: new Date(), notes: `Customer requested a ${waitDays}-day stock wait window.` } }
        }, { new: true }).lean();
        if (!updatedRequest) {
            await FulfillmentCase.updateOne({ _id: created._id, customerId: String(req.user.sub) }, { $set: { status: 'CANCELLED' } });
            const latest = await dataStore.getMedicineRequestById(req.params.id, req.user);
            if (latest?.fulfillmentCaseId) {
                const existing = await FulfillmentCase.findOne({ _id: latest.fulfillmentCaseId, customerId: String(req.user.sub) }).lean();
                if (existing) return res.status(200).json({ case: existing, alreadyCreated: true });
            }
            return res.status(409).json({ message: 'The medicine request changed while saving. Refresh and try again.' });
        }
        return res.status(201).json({ case: created.toObject(), request: updatedRequest, message: 'Your medicine request is now on the stock waitlist.' });
    } catch (error) {
        if (error.code === 11000) {
            const request = await dataStore.getMedicineRequestById(req.params.id, req.user);
            if (request?.fulfillmentCaseId) {
                const existing = await FulfillmentCase.findOne({ _id: request.fulfillmentCaseId, customerId: String(req.user.sub) }).lean();
                if (existing) return res.status(200).json({ case: existing, alreadyCreated: true });
            }
        }
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to add medicine request to the stock waitlist.' });
    }
});

router.post('/fulfillment/waitlist/:id/confirm', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Stock waitlist confirmation is temporarily unavailable.' });
    let claimed = null;
    const confirmationId = randomUUID();
    const finalize = async order => {
        const confirmationLines = claimed.confirmationLines || [];
        const remainingLines = (claimed.lines || []).map(line => {
            const confirmed = confirmationLines.find(item => String(item.productId) === String(line.productId));
            const allocated = Math.min(Number(confirmed?.allocatedQuantity || 0), Number(line.waitingQuantity || 0));
            return {
                ...line,
                requestedQuantity: Math.max(0, Number(line.waitingQuantity || 0) - allocated),
                allocatedQuantity: 0,
                waitingQuantity: Math.max(0, Number(line.waitingQuantity || 0) - allocated),
                notifiedAvailableQuantity: 0
            };
        }).filter(line => line.requestedQuantity > 0);
        const updated = await FulfillmentCase.updateOne({
            _id: claimed._id, customerId: String(req.user.sub),
            status: 'CONFIRMING', confirmationId
        }, {
            $set: {
                lines: remainingLines,
                status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'FULFILLED',
                parentOrderId: String(order._id),
                confirmationId: null, confirmingAt: null,
                confirmationPreviousStatus: null, confirmationLines: [],
                lastAvailabilityCheckAt: new Date()
            },
            $push: { auditTrail: { action: 'AVAILABLE_STOCK_CONFIRMED', actorId: String(req.user.sub), at: new Date(), orderId: String(order._id), fulfilledLineCount: confirmationLines.length } }
        });
        if (!updated.modifiedCount) {
            throw Object.assign(new Error('Order was created, but the waitlist update is still being reconciled. Refresh your waitlist shortly.'), { statusCode: 202 });
        }
        if (claimed.parentOrderId) {
            await Order.updateOne({ _id: claimed.parentOrderId, userId: String(req.user.sub), tenantId: claimed.tenantId }, {
                $set: { fulfillmentState: remainingLines.length ? 'PARTIAL' : 'COMPLETE' }
            });
        }
        if (claimed.sourceType === 'MEDICINE_REQUEST' && claimed.sourceId) {
            await MedicineRequest.updateOne({ _id: claimed.sourceId, customerId: String(req.user.sub), fulfillmentCaseId: String(claimed._id) }, {
                $set: { status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'CONVERTED_TO_ORDER', convertedOrderId: String(order._id) },
                $push: { auditTrail: { action: 'WAITLIST_STOCK_ORDER_CREATED', actorId: String(req.user.sub), role: 'Customer', timestamp: new Date(), notes: `Created order ${String(order._id)} from available waitlist stock.` } }
            });
        }
        return { order, remainingLines };
    };
    try {
        const initial = await FulfillmentCase.findOne({
            _id: req.params.id, customerId: String(req.user.sub),
            status: { $in: ['READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'] },
            waitUntil: { $gt: new Date() }
        }).lean();
        if (!initial) return res.status(404).json({ message: 'No active stock-ready waitlist entry was found.' });
        if (!initial.addressId || !initial.deliveryAddress || !hasValidCoordinates(initial.coordinates)) {
            return res.status(409).json({ message: 'Please update a verified delivery address before confirming this stock-ready request.' });
        }
        const confirmationLines = (initial.lines || []).filter(line => Number(line.allocatedQuantity || 0) > 0);
        if (!confirmationLines.length) return res.status(409).json({ message: 'No requested quantity is currently available.' });
        claimed = await FulfillmentCase.findOneAndUpdate({
            _id: initial._id, customerId: String(req.user.sub),
            status: initial.status, waitUntil: { $gt: new Date() }
        }, {
            $set: {
                status: 'CONFIRMING',
                confirmationId,
                confirmingAt: new Date(),
                confirmationPreviousStatus: initial.status,
                confirmationLines
            },
            $push: { auditTrail: { action: 'STOCK_CONFIRMATION_STARTED', actorId: String(req.user.sub), at: new Date(), confirmationId } }
        }, { new: true }).lean();
        if (!claimed) return res.status(409).json({ message: 'Another confirmation is already in progress. Refresh your waitlist.' });
        try {
            const order = await dataStore.reserveOrder({
                userId: String(req.user.sub), tenantId: claimed.tenantId, branchId: claimed.branchId,
                addressId: claimed.addressId, deliveryAddress: claimed.deliveryAddress,
                addressDetails: claimed.addressDetails || {}, coordinates: claimed.coordinates,
                paymentMethod: claimed.paymentMethod || 'Cash on Delivery (COD)',
                source: claimed.sourceType === 'MEDICINE_REQUEST' ? 'MEDICINE_REQUEST' : 'WEB',
                medicineRequestId: claimed.sourceType === 'MEDICINE_REQUEST' ? claimed.sourceId : null,
                customerName: claimed.orderedForName || 'Customer',
                customerMobile: claimed.customerMobile || '',
                orderedForName: claimed.orderedForName || 'Customer',
                fulfillmentCaseId: String(claimed._id),
                fulfillmentConfirmationId: confirmationId,
                prescriptionUrl: claimed.prescriptionUrl || null, prescriptionId: claimed.prescriptionId || null,
                patientPuid: claimed.patientPuid || null,
                items: confirmationLines.map(line => ({ medicineId: line.productId, quantity: Number(line.allocatedQuantity), unitPrice: Number(line.unitPrice) }))
            }, 'Customer stock waitlist confirmation');
            const completed = await finalize(order);
            return res.status(201).json({ order: completed.order, waitlistCaseId: String(claimed._id), remainingItems: completed.remainingLines, message: 'Available stock has been reserved and a new order has been created.' });
        } catch (confirmationError) {
            const existingOrder = await Order.findOne({ fulfillmentConfirmationId: confirmationId }).lean();
            if (existingOrder) {
                const completed = await finalize(existingOrder);
                return res.status(201).json({ order: completed.order, waitlistCaseId: String(claimed._id), remainingItems: completed.remainingLines, message: 'Your stock reservation was completed and reconciled.' });
            }
            await FulfillmentCase.updateOne({ _id: claimed._id, customerId: String(req.user.sub), status: 'CONFIRMING', confirmationId }, {
                $set: {
                    status: claimed.confirmationPreviousStatus || 'WAITING_FOR_STOCK',
                    confirmationId: null, confirmingAt: null,
                    confirmationPreviousStatus: null, confirmationLines: []
                },
                $push: { auditTrail: { action: 'STOCK_CONFIRMATION_FAILED', actorId: String(req.user.sub), at: new Date(), notes: confirmationError.message } }
            });
            throw confirmationError;
        }
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to confirm available stock.' });
    }
});

router.post('/fulfillment/waitlist/:id/cancel', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Stock waitlist is temporarily unavailable.' });
    try {
        const updated = await FulfillmentCase.findOneAndUpdate({
            _id: req.params.id, customerId: String(req.user.sub),
            status: { $in: ['WAITING_FOR_STOCK', 'AWAITING_CUSTOMER_DECISION', 'READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'] }
        }, {
            $set: { status: 'CANCELLED' },
            $push: { auditTrail: { action: 'WAITLIST_CANCELLED', actorId: String(req.user.sub), at: new Date() } }
        }, { new: true }).lean();
        if (!updated) return res.status(404).json({ message: 'Active stock waitlist entry not found.' });
        if (updated.parentOrderId) await Order.updateOne({ _id: updated.parentOrderId, userId: String(req.user.sub), tenantId: updated.tenantId }, { $set: { fulfillmentState: 'PARTIAL' } });
        if (updated.sourceType === 'MEDICINE_REQUEST' && updated.sourceId) {
            await MedicineRequest.updateOne({ _id: updated.sourceId, customerId: String(req.user.sub), fulfillmentCaseId: String(updated._id) }, {
                $set: { status: updated.parentOrderId ? 'CONVERTED_TO_ORDER' : 'CANCELLED' },
                $push: { auditTrail: { action: 'WAITLIST_CANCELLED', actorId: String(req.user.sub), role: 'Customer', timestamp: new Date(), notes: 'Customer cancelled the stock waitlist.' } }
            });
        }
        return res.json({ case: updated, message: 'Stock waitlist entry cancelled.' });
    } catch {
        return res.status(503).json({ message: 'Unable to cancel stock waitlist entry.' });
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
        const selectedTenantId = String(req.body.tenantId || '').trim();
        if (!selectedTenantId) {
            return res.status(400).json({ code: 'PHARMACY_SELECTION_REQUIRED', message: 'Select a pharmacy before placing your order.' });
        }
        if (!getIsConnected()) {
            return res.status(503).json({ message: 'Pharmacy verification is unavailable. No order was created.' });
        }
        const selectedTenant = await Tenant.findOne({ _id: selectedTenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!selectedTenant) {
            return res.status(404).json({ code: 'PHARMACY_UNAVAILABLE', message: 'The selected pharmacy is no longer available. Please choose another pharmacy.' });
        }
        const cartItems = parseCheckoutItems(req.body.items || req.body.cartItems);
        if (!Array.isArray(cartItems) || !cartItems.length) {
            return res.status(400).json({ message: 'Add at least one medicine to your order.' });
        }
        
        let chosenAddressLine = deliveryAddress;
        let chosenCoords = coordinates;
        if (typeof chosenCoords === 'string') {
            try { chosenCoords = JSON.parse(chosenCoords); } catch {}
        }

        let addressSnapshot = null;
        if (addressId) {
            addressSnapshot = await dataStore.getUserAddress(req.user.sub, addressId);
            if (addressSnapshot) {
                chosenAddressLine = addressSnapshot.addressLine || `${addressSnapshot.addressLine1}, ${addressSnapshot.city} - ${addressSnapshot.pincode}`;
                chosenCoords = addressSnapshot.coordinates || chosenCoords;
            } else if (!chosenAddressLine?.trim() || !hasValidCoordinates(chosenCoords)) {
                return res.status(400).json({ message: "Selected delivery address was not found. Refresh your address list and try again." });
            }
        }

        if (!chosenAddressLine?.trim() || !hasValidCoordinates(chosenCoords)) {
            return res.status(400).json({ message: 'A delivery address with a confirmed map pin is required to place an order.' });
        }

        const customerName = req.user.user_metadata?.name || req.user.email?.split('@')[0] || "Customer";
        if (prescriptionUrl && !prescriptionUrl.startsWith('/api/orders/prescriptions/')) {
            return res.status(400).json({ message: 'Prescription URL must refer to a private uploaded prescription.' });
        }
        let uploadedPrescriptionId = null;
        let orderedForPerson = null;
        const requestedPatientPuid = String(req.body.patientPuid || '').trim();
        if (requestedPatientPuid) {
            try {
                orderedForPerson = await customerService.getManagedPerson(req.user.sub, requestedPatientPuid);
            } catch (error) {
                return res.status(error.statusCode || 403).json({
                    message: 'The selected customer or relative profile is not managed by this account.'
                });
            }
        } else {
            try {
                const customer = await customerService.ensureCustomerForUser(req.user.sub, {
                    name: customerName,
                    email: req.user.email || ''
                });
                orderedForPerson = await customerService.getManagedPerson(req.user.sub, customer.selfPuid);
            } catch (error) {
                return res.status(error.statusCode || 503).json({
                    message: 'Your customer identity could not be verified. Please refresh your profile and try again.'
                });
            }
        }
        if (req.file) {
            uploadedPrescriptionUrl = await savePrescription(req.file, req.user.sub, selectedTenantId);
            if (prescriptionClient.isConfigured()) {
                try {
                    const uploaded = await prescriptionClient.upload({
                        buffer: req.file.buffer,
                        filename: req.file.originalname,
                        contentType: req.file.mimetype,
                        idempotencyKey: req.get('Idempotency-Key') || null,
                        userId: req.user.sub,
                        tenantId: req.user.tenantId || req.user.app_metadata?.tenantId || null,
                        branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
                        role: req.user?.app_metadata?.role || req.user?.role || 'customer',
                        patientPuid: orderedForPerson?.puid || req.body.patientPuid || null,
                        orderId: null
                    });
                    uploadedPrescriptionId = uploaded?.prescriptionId || null;
                    if (uploadedPrescriptionId) {
                        uploadedPrescriptionUrl = `/api/v1/prescriptions/${encodeURIComponent(uploadedPrescriptionId)}/document`;
                    }
                } catch (clientErr) {
                    console.warn('PrescriptionClient upload warning, continuing with stored prescription:', clientErr.message);
                }
            }
        } else {
            uploadedPrescriptionUrl = prescriptionUrl || null;
        }
        if (prescriptionUrl && !req.file) {
            const existingPrescription = await getPrescription(prescriptionUrl.split('/').at(-1));
            if (!existingPrescription || existingPrescription.ownerId !== req.user.sub) {
                return res.status(403).json({ message: 'The uploaded prescription does not belong to this account.' });
            }
        }

        const order = await dataStore.reserveOrder({
            userId: req.user.sub,
            tenantId: selectedTenantId,
            branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
            addressId: addressSnapshot?._id || addressId || null,
            customerName,
            customerMobile: addressSnapshot?.mobile || req.body.mobile || req.body.addressDetails?.mobile || req.body.addressDetails?.phone || req.user.user_metadata?.mobile || '',
            items: cartItems,
            pointsToRedeem,
            couponCode,
            prescriptionUrl: uploadedPrescriptionUrl,
            prescriptionId: uploadedPrescriptionId,
            patientPuid: orderedForPerson.puid,
            orderedForName: orderedForPerson.displayName,
            orderedForRelationship: orderedForPerson.relationshipToOwner || 'SELF',
            deliveryAddress: chosenAddressLine,
            addressDetails: addressSnapshot ? {
                label: addressSnapshot.label,
                fullName: addressSnapshot.fullName,
                mobile: addressSnapshot.mobile,
                addressLine1: addressSnapshot.addressLine1,
                addressLine2: addressSnapshot.addressLine2,
                city: addressSnapshot.city,
                state: addressSnapshot.state,
                postalCode: addressSnapshot.postalCode || addressSnapshot.pincode || '',
                pincode: addressSnapshot.pincode,
                country: addressSnapshot.country || 'India',
                landmark: addressSnapshot.landmark,
                coordinates: addressSnapshot.coordinates
            } : {},
            coordinates: chosenCoords,
            paymentMethod: paymentMethod || "Cash on Delivery (COD)"
        }, customerName);

        if (uploadedPrescriptionId && order?._id) {
            try {
                await prescriptionClient.linkOrder(uploadedPrescriptionId, order._id, {
                    userId: req.user.sub,
                    tenantId: req.user.tenantId || req.user.app_metadata?.tenantId || null,
                    branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
                    role: req.user?.app_metadata?.role || req.user?.role || 'customer'
                });
            } catch (conversionError) {
                console.error('Prescription-to-order association failed after order creation:', conversionError);
            }
        }

        // Automated messaging trigger
        await sendCustomWhatsAppAlert(order, 'Placed');

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
        const selectedTenantId = String(req.body?.tenantId || '').trim();
        if (!selectedTenantId) {
            return res.status(400).json({
                code: 'PHARMACY_SELECTION_REQUIRED',
                message: 'Select a pharmacy before calculating reward points.'
            });
        }
        const items = parseCheckoutItems(req.body.items || req.body.cartItems);
        const pointsToRedeem = Number(req.body.pointsToRedeem || 0);
        if (!Number.isSafeInteger(pointsToRedeem) || pointsToRedeem < 0) {
            return res.status(400).json({ message: 'Points to redeem must be a non-negative whole number.' });
        }
        const quote = await dynamicOrderService.evaluateCheckout(
            items,
            req.user.sub,
            pointsToRedeem,
            { couponCode: req.body.couponCode || undefined, tenantId: selectedTenantId }
        );
        return res.json(quote);
    } catch (error) {
        console.error('Checkout reward quote failed:', error);
        return res.status(getErrorStatus(error)).json({
            message: error.message || 'Unable to calculate the reward quote.'
        });
    }
});

// Prescription uploads are private files backed by MongoDB GridFS when configured.
router.get('/prescriptions/:fileId', authenticateUser, async (req, res) => {
    try {
        const prescription = await getPrescription(req.params.fileId);
        if (!prescription) return res.status(404).json({ message: 'Prescription file not found.' });
        const role = req.user?.app_metadata?.role || req.user?.role || 'customer';
        const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
        const normalizedRoles = new Set([role, ...roles].map(value => String(value || '').toUpperCase()));
        const globalAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].some(value => normalizedRoles.has(value));
        const tenantStaff = [
            'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACY', 'PHARMACIST',
            'PHARMACY_STAFF', 'BRANCH_ADMIN'
        ].some(value => normalizedRoles.has(value));
        const tenantId = req.user?.tenantId || req.user?.app_metadata?.tenantId || null;
        const branchId = req.user?.branchId || req.user?.app_metadata?.branchId || null;

        let relatedOrder = null;
        if (prescription.ownerId !== req.user.sub && !globalAdmin && tenantStaff) {
            const prescriptionUrl = `/api/orders/prescriptions/${req.params.fileId}`;
            if (getIsConnected()) {
                relatedOrder = await Order.findOne({
                    $or: [{ prescriptionUrl }, { prescriptionId: req.params.fileId }]
                }).select('tenantId branchId userId customerId').lean();
            } else {
                const orders = await dataStore.getAllOrders();
                relatedOrder = orders.find(order =>
                    order.prescriptionUrl === prescriptionUrl || String(order.prescriptionId || '') === String(req.params.fileId)
                ) || null;
            }
        }
        const tenantMatches = Boolean(tenantId && prescription.tenantId && String(tenantId) === String(prescription.tenantId)
            && relatedOrder?.tenantId && String(tenantId) === String(relatedOrder.tenantId));
        const branchMatches = !branchId || Boolean(relatedOrder?.branchId && String(branchId) === String(relatedOrder.branchId));
        const isAuthorizedStaff = globalAdmin || (tenantStaff && tenantMatches && branchMatches);

        if (prescription.ownerId !== req.user.sub && !isAuthorizedStaff) {
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

// Verify the actual prescription against the order's included medicines.
router.get(['/prescriptions/:fileId/scan', '/:id/scan-prescription'], authenticateUser, async (req, res) => {
    try {
        const order = await dataStore.getOrderById(req.params.id || req.params.fileId);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

        if (!canTenantAccessOrder(req, order)) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        if (!order.prescriptionRequired) {
            return res.json({
                success: true,
                verified: true,
                status: 'NOT_REQUIRED',
                confidence: 1,
                scannedMedicines: [],
                issues: []
            });
        }

        if (!order.prescriptionId) {
            return res.status(409).json({
                success: false,
                verified: false,
                status: 'REVIEW_REQUIRED',
                confidence: 0,
                scannedMedicines: [],
                issues: ['Order does not have a linked Python Prescription Service record.']
            });
        }

        await reinitiatePrescriptionProcessing({
            prescriptionId: order.prescriptionId,
            userId: req.user.sub,
            role: 'admin',
            isAdmin: true
        });

        const verification = await verifyPrescriptionAgainstItems({
            prescriptionId: order.prescriptionId,
            patientPuid: order.patientPuid || null,
            items: (order.items || order.medicineItems || []).map(item => ({
                productId: item.productId || item.medicineId || null,
                name: item.productName || item.name || '',
                productName: item.productName || item.name || '',
                strength: item.strength || '',
                form: item.form || item.dosageForm || '',
                quantity: Number(item.quantity || 0)
            })),
            userId: req.user.sub,
            tenantId: order.tenantId || req.user.tenantId || null,
            branchId: order.branchId || req.user.branchId || null,
            isAdmin: admin
        });

        return res.json({
            success: true,
            verified: verification.status === 'MATCHED',
            status: verification.status,
            confidence: Number(verification.overallConfidence || 0),
            scannedMedicines: verification.medicines || [],
            issues: verification.issues || [],
            verifiedAt: verification.lastCheckedAt || new Date().toISOString()
        });
    } catch (err) {
        console.error('Prescription verification failed:', err);
        return res.status(err.statusCode || 503).json({
            success: false,
            message: err.message || 'Failed to verify prescription.'
        });
    }
});;

router.put('/:id/review', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { status, decision, prescriptionVerified } = req.body;
        const reviewDecision = status || decision;
        if (!['Approved', 'Rejected'].includes(reviewDecision)) {
            return res.status(400).json({ message: 'Review status must be Approved or Rejected.' });
        }

        let order = await dataStore.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found.' });

        if (!canTenantAccessOrder(req, order)) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        if (reviewDecision === 'Approved' && order.prescriptionRequired) {
            if (!order.prescriptionId) {
                return res.status(409).json({
                    message: 'This order requires a Prescription Service record before approval.'
                });
            }

            // A pharmacist/admin may explicitly approve after reviewing the document.
            // Do not call the automated verifier again for an already recorded manual approval.
            if (order.prescriptionVerification?.status === 'MATCHED'
                && order.prescriptionVerification?.manualApproval === true) {
                // Manual approval is authoritative for this reviewed order.
            } else {
                const verification = await verifyPrescriptionAgainstItems({
                prescriptionId: order.prescriptionId,
                patientPuid: order.patientPuid || null,
                items: (order.items || order.medicineItems || []).map(item => ({
                    productId: item.productId || item.medicineId || null,
                    name: item.productName || item.name || '',
                    productName: item.productName || item.name || '',
                    strength: item.strength || '',
                    form: item.form || item.dosageForm || '',
                    quantity: Number(item.quantity || 0)
                })),
                userId: req.user.sub,
                tenantId: order.tenantId || req.user.tenantId || null,
                branchId: order.branchId || req.user.branchId || null,
                isAdmin: true
            });
            if (verification.status !== 'MATCHED') {
                return res.status(409).json({
                    message: 'Prescription verification must match all included medicines before order approval.',
                    verification
                });
            }
                if (getIsConnected() && order._id) {
                    await Order.findByIdAndUpdate(order._id, {
                        $set: {
                            prescriptionVerification: verification,
                            prescriptionId: verification.prescriptionId || order.prescriptionId,
                            patientPuid: verification.patientPuid || order.patientPuid || null
                        }
                    });
                }
            }
        }

        order = await dataStore.reviewOrder(
            req.params.id,
            reviewDecision === 'Approved' ? 'approve' : 'reject',
            req.user.user_metadata?.name || req.user.email || 'Admin'
        );

        let assignmentMessage = '';
        if (reviewDecision === 'Approved') {
            try {
                deliveryContainer.refreshDataLayer();
                const result = await deliveryContainer.assignmentEngine.assignOrder(String(order._id), { tenantId: order.tenantId });
                if (result.success) {
                    order = result.order.toJSON ? result.order.toJSON() : result.order;
                    assignmentMessage = ` Rider ${result.rider.name} was assigned automatically.`;
                    try {
                        await sendCustomWhatsAppAlert(order, 'Assigned', result.rider.mobile);
                    } catch (notificationError) {
                        console.warn(`[WhatsApp] Assignment notification failed for order ${order._id}:`, notificationError.message);
                    }
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

router.post('/admin/:id/prescription/reinitiate', authenticateUser, isAdmin, async (req, res) => {
    try {
        const order = await dataStore.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (!order.prescriptionRequired) {
            return res.status(400).json({ message: 'This order does not require prescription verification.' });
        }

        const items = (order.items || order.medicineItems || []).map(item => ({
            productId: item.productId || item.medicineId || null,
            name: item.productName || item.name || '',
            productName: item.productName || item.name || '',
            strength: item.strength || '',
            form: item.form || item.dosageForm || '',
            quantity: Number(item.quantity || 0)
        }));

        if (!order.prescriptionId) {
            return res.status(409).json({
                code: 'PRESCRIPTION_NOT_LINKED',
                message: 'No Prescription Service record is linked to this order. Manual approval is required.'
            });
        }

        // Re-enqueue the durable Prescription Service job first. Verification
        // alone only reads the current PROCESSING/REVIEW_REQUIRED snapshot and
        // cannot restart a stuck OCR/extraction job.
        const reprocessResult = await reinitiatePrescriptionProcessing({
            prescriptionId: order.prescriptionId,
            userId: req.user.sub,
            role: 'admin',
            isAdmin: true
        });

        const verification = await verifyPrescriptionAgainstItems({
            prescriptionId: order.prescriptionId,
            patientPuid: order.patientPuid || null,
            items,
            userId: req.user.sub,
            role: 'admin',
            isAdmin: true
        });

        if (getIsConnected() && order._id) {
            await Order.findByIdAndUpdate(order._id, {
                $set: {
                    prescriptionVerification: verification,
                    'fulfillmentGate.prescription': verification.status === 'MATCHED' ? 'APPROVED' : 'PENDING_REVIEW'
                },
                $push: {
                    statusHistory: {
                        previousStatus: order.orderStatus,
                        newStatus: order.orderStatus,
                        changedBy: req.user.user_metadata?.name || req.user.email || 'Admin',
                        timestamp: new Date(),
                        notes: 'Prescription verification re-initiated by admin.'
                    }
                }
            });
        }

        return res.json({
            success: true,
            message: verification.status === 'MATCHED'
                ? 'Prescription verification completed successfully.'
                : 'Prescription processing was re-queued. Refresh this order after extraction completes, or use manual review after opening the uploaded prescription.',
            processing: reprocessResult?.status || reprocessResult?.state || 'QUEUED',
            verification
        });
    } catch (err) {
        console.error('Prescription re-initiation failed:', err);
        return res.status(getErrorStatus(err)).json({ message: err.message || 'Could not re-initiate prescription verification.' });
    }
});

router.post('/admin/:id/prescription/manual-approve', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { scope = 'order', itemIndex, reason = '' } = req.body || {};
        const order = await dataStore.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (!order.prescriptionRequired) {
            return res.status(400).json({ message: 'This order does not require prescription approval.' });
        }
        if (!order.prescriptionUrl && !order.prescriptionId) {
            return res.status(409).json({ message: 'Manual approval is blocked because no prescription document is attached to this order.' });
        }
        const decisionReason = String(reason || '').trim();
        if (!decisionReason) {
            return res.status(400).json({ message: 'A pharmacist decision note is required for manual prescription approval.' });
        }
        if (scope === 'medicine' && (!Number.isInteger(Number(itemIndex)) || Number(itemIndex) < 0)) {
            return res.status(400).json({ message: 'A valid medicine itemIndex is required.' });
        }

        const items = order.items || order.medicineItems || [];
        if (scope === 'medicine' && Number(itemIndex) >= items.length) {
            return res.status(400).json({ message: 'Medicine item was not found in this order.' });
        }

        const existingVerification = order.prescriptionVerification || {};
        const existingMedicines = Array.isArray(existingVerification.medicines)
            ? existingVerification.medicines
            : [];
        const medicines = items.map((item, index) => {
            const current = existingMedicines[index] || {};
            const shouldApprove = scope === 'order' || index === Number(itemIndex);
            return {
                ...current,
                orderMedicine: current.orderMedicine || item.productName || item.name || item.genericName || 'Medicine',
                productId: current.productId || item.productId || item.medicineId || null,
                status: shouldApprove ? 'MATCHED' : (current.status || 'REVIEW_REQUIRED'),
                manualApproved: shouldApprove ? true : Boolean(current.manualApproved),
                manualApprovedBy: shouldApprove
                    ? (req.user.user_metadata?.name || req.user.email || 'Admin')
                    : current.manualApprovedBy,
                manualApprovedAt: shouldApprove ? new Date().toISOString() : current.manualApprovedAt,
                manualApprovalReason: shouldApprove ? decisionReason.slice(0, 500) : current.manualApprovalReason
            };
        });

        const allMedicinesApproved = medicines.length > 0 && medicines.every(medicine => medicine.manualApproved === true);
        const verification = {
            ...existingVerification,
            status: allMedicinesApproved ? 'MATCHED' : 'REVIEW_REQUIRED',
            prescriptionId: order.prescriptionId || existingVerification.prescriptionId || null,
            patientPuid: order.patientPuid || existingVerification.patientPuid || null,
            overallConfidence: allMedicinesApproved ? 1 : Number(existingVerification.overallConfidence || 0),
            lastCheckedAt: new Date(),
            medicines,
            issues: allMedicinesApproved ? [] : ['One or more medicines still require manual approval.'],
            manualApproval: true,
            manualApprovalScope: scope,
            manualApprovedBy: req.user.user_metadata?.name || req.user.email || 'Admin',
            manualApprovalAt: new Date(),
            manualApprovalReason: decisionReason.slice(0, 500)
        };

        if (getIsConnected() && order._id) {
            await Order.findByIdAndUpdate(order._id, {
                $set: {
                    prescriptionVerification: verification,
                    'fulfillmentGate.prescription': allMedicinesApproved ? 'APPROVED' : 'PENDING_REVIEW'
                },
                $push: {
                    statusHistory: {
                        previousStatus: order.orderStatus,
                        newStatus: order.orderStatus,
                        changedBy: req.user.user_metadata?.name || req.user.email || 'Admin',
                        timestamp: new Date(),
                        notes: `Manual prescription decision (${scope}): ${decisionReason.slice(0, 500)}`
                    }
                }
            });
        }

        return res.json({
            success: true,
            message: allMedicinesApproved
                ? 'All prescription medicines approved. Order is now eligible for fulfillment.'
                : 'Medicine manually approved. Remaining medicines still require review.',
            verification
        });
    } catch (err) {
        console.error('Manual prescription approval failed:', err);
        return res.status(getErrorStatus(err)).json({ message: err.message || 'Manual prescription approval failed.' });
    }
});

router.put('/:id/dispatch', authenticateUser, isAdmin, async (req, res) => {
    try {
        const targetOrder = await Order.findById(req.params.id).select('_id tenantId').lean();
        if (!targetOrder) return res.status(404).json({ message: 'Order not found.' });
        if (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || '')) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        const riderInfo = await resolveDispatchRider(req.body.riderInfo?.riderId, req.params.id, targetOrder.tenantId);
        const order = await dataStore.dispatchOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Admin',
            riderInfo
        );
        await sendCustomWhatsAppAlert(order, 'Dispatched', order.rider?.riderMobile);
        res.json({ message: 'Order dispatched and reserved inventory deducted.', order });
    } catch (err) {
        console.error('Order dispatch failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to dispatch order.' });
    }
});

router.post('/admin/:id/auto-assign', authenticateUser, isAdmin, async (req, res) => {
    try {
        if (!getIsConnected()) {
            return res.status(503).json({ message: 'Auto-assignment requires an active MongoDB connection.' });
        }
        deliveryContainer.refreshDataLayer();
        const orderId = req.params.id;
        const targetOrder = await Order.findById(orderId).select('_id tenantId').lean();
        if (!targetOrder || (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || ''))) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        const result = await deliveryContainer.assignmentEngine.assignOrder(orderId, { tenantId: targetOrder.tenantId });
        if (!result.success) {
            return res.status(404).json({
                success: false,
                message: result.reason || 'No available rider found for automatic assignment. Please assign manually.'
            });
        }
        const updatedOrder = result.order.toJSON ? result.order.toJSON() : result.order;
        try {
            await sendCustomWhatsAppAlert(updatedOrder, 'Assigned', result.rider.mobile);
        } catch (notificationError) {
            console.warn(`[WhatsApp] Auto-assign notification failed for order ${orderId}:`, notificationError.message);
        }
        return res.json({
            success: true,
            message: `Order successfully auto-assigned to rider ${result.rider.name}!`,
            order: updatedOrder,
            rider: result.rider
        });
    } catch (err) {
        console.error('Auto-assignment failed:', err);
        return res.status(getErrorStatus(err)).json({
            success: false,
            message: err.message || 'Auto-assignment failed.'
        });
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
        const existingOrder = await Order.findOne({
            _id: req.params.id,
            $or: [{ userId: req.user.sub }, { customerId: req.user.sub }]
        }).select('_id tenantId').lean();
        if (!existingOrder) return res.status(404).json({ message: 'Order not found.' });
        if (req.file) {
            uploadedPrescriptionUrl = await savePrescription(req.file, req.user.sub, existingOrder.tenantId || null);
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

const handleCustomerCancelOrder = async (req, res) => {
    try {
        if (req.user?.app_metadata?.role === 'admin') {
            return res.status(403).json({ message: 'Customers can only cancel their own orders.' });
        }
        const order = await dataStore.cancelOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Customer',
            req.user.sub
        );
        res.json({ message: 'Order cancelled and reserved stock released.', order });
    } catch (err) {
        console.error('Order cancellation failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to cancel order.' });
    }
};

router.put('/:id/cancel', authenticateUser, handleCustomerCancelOrder);
router.post('/:id/cancel', authenticateUser, handleCustomerCancelOrder);

// Order State Machine Transition
router.post('/admin/transition', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { orderId, newStatus, cashCollectionStatus } = req.body;
        if (isTenantOrderStaff(req)) {
            const tenantId = getActorTenantId(req);
            if (!tenantId) return res.status(403).json({ message: 'An active tenant context is required.' });
            const scopedOrder = await Order.findOne({ _id: orderId, tenantId: String(tenantId) }).select('_id').lean();
            if (!scopedOrder) return res.status(404).json({ message: 'Order not found.' });
        }
        let { riderInfo } = req.body;
        if (!orderId || !newStatus) {
            return res.status(400).json({ message: "orderId and newStatus are required." });
        }
        const targetOrder = await Order.findById(orderId).select('_id tenantId').lean();
        if (!targetOrder || (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || ''))) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        if (newStatus === 'Dispatched') {
            deliveryContainer.refreshDataLayer();
            const currentOrder = await deliveryContainer.orderRepository.findById(orderId, targetOrder.tenantId);
            riderInfo = await resolveDispatchRider(
                riderInfo?.riderId || currentOrder?.rider?.riderId,
                orderId,
                targetOrder.tenantId
            );
        }

        const actor = req.user.user_metadata?.name || req.user.email || 'Pharmacist Admin';
        let updatedOrder = await dataStore.transitionOrderStatus(orderId, newStatus, actor, riderInfo, cashCollectionStatus);
        let assignmentMessage = '';
        let notificationEvent = newStatus === 'Ready to Dispatch' ? 'Ready to Dispatch' : null;
        let notificationMobile = updatedOrder.rider?.riderMobile;

        if (newStatus === 'Approved' || newStatus === 'Ready to Dispatch') {
            try {
                deliveryContainer.refreshDataLayer();
                const assignResult = await deliveryContainer.assignmentEngine.assignOrder(orderId, { tenantId: targetOrder.tenantId });
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

        // Trigger notification according to lifecycle
        if (newStatus === 'Dispatched') notificationEvent = 'Dispatched';
        else if (newStatus === 'Delivered') notificationEvent = 'Delivered';

        if (notificationEvent) {
            try {
                await sendCustomWhatsAppAlert(updatedOrder, notificationEvent, notificationMobile);
            } catch (notificationError) {
                console.warn(`[WhatsApp] ${notificationEvent} notification failed:`, notificationError.message);
            }
        }

        res.json({
            message: `Order transitioned to ${newStatus}.${assignmentMessage}`,
            order: updatedOrder,
            deliveryRewards: updatedOrder.deliveryRewards || null
        });
    } catch (err) {
        console.error("Transition error:", err);
        res.status(getErrorStatus(err)).json({
            code: err.code || 'ORDER_TRANSITION_FAILED',
            message: err.message || "State transition failed",
            retryable: ['PRESCRIPTION_PROCESSING_STUCK', 'PRESCRIPTION_SERVICE_UNAVAILABLE'].includes(err.code)
        });
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
        const tenantId = isTenantOrderStaff(req)
            ? getActorTenantId(req)
            : (getActorTenantId(req) || req.body.tenantId || null);
        if (!tenantId) return res.status(400).json({ message: 'Select a pharmacy tenant before planning a route.' });
        if (!riderId) return res.status(400).json({ message: 'Select an onboarded rider before planning a route.' });
        const rider = await deliveryContainer.riderRepository.findById(riderId, tenantId);
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
            Number(startLng) || 77.5946,
            tenantId
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
        const targetOrders = await Order.find({ _id: { $in: orderIds } }).select('_id tenantId').lean();
        if (targetOrders.length !== new Set(orderIds.map(String)).size) return res.status(404).json({ message: 'One or more orders were not found.' });
        const targetTenantIds = [...new Set(targetOrders.map(order => String(order.tenantId || '')))];
        if (targetTenantIds.length !== 1 || !targetTenantIds[0]) return res.status(400).json({ message: 'A dispatch batch must contain orders from exactly one pharmacy tenant.' });
        const targetTenantId = targetTenantIds[0];
        if (isTenantOrderStaff(req) && targetTenantId !== String(getActorTenantId(req) || '')) return res.status(404).json({ message: 'Orders not found.' });
        const riderInfo = await resolveDispatchRider(riderId, null, targetTenantId);

        const actor = req.user.user_metadata?.name || req.user.email || 'Logistics Admin';

        const dispatchedOrders = [];
        const dispatchErrors = [];
        for (const id of orderIds) {
            try {
                const updated = await dataStore.transitionOrderStatus(id, 'Dispatched', actor, riderInfo);
                dispatchedOrders.push(updated);
                try {
                    await sendCustomWhatsAppAlert(updated, 'Dispatched', riderInfo.riderMobile);
                } catch (notificationError) {
                    console.warn(`[WhatsApp] Batch dispatch notification failed for order ${id}:`, notificationError.message);
                }
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
        const targetOrder = await Order.findById(orderId).select('_id tenantId').lean();
        if (!targetOrder || (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || ''))) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        if (targetStatus === 'Dispatched') {
            deliveryContainer.refreshDataLayer();
            const currentOrder = await deliveryContainer.orderRepository.findById(orderId, targetOrder.tenantId);
            riderInfo = await resolveDispatchRider(currentOrder?.rider?.riderId, orderId, targetOrder.tenantId);
        }
        let order = await dataStore.transitionOrderStatus(orderId, targetStatus, actor, riderInfo);
        let assignmentMessage = '';
        let notificationEvent = step === 'ready' ? 'Ready to Dispatch' : null;
        if (step === 'ready') {
            try {
                deliveryContainer.refreshDataLayer();
                const result = await deliveryContainer.assignmentEngine.assignOrder(orderId, { tenantId: targetOrder.tenantId });
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
            try {
                await sendCustomWhatsAppAlert(order, notificationEvent, order.rider?.riderMobile);
            } catch (notificationError) {
                console.warn(`[WhatsApp] ${notificationEvent} notification failed for order ${orderId}:`, notificationError.message);
            }
        }

        res.json({ message: `Transaction status shifted safely.${assignmentMessage}`, order });
    } catch (err) {
        console.error("Order status update failed:", err);
        res.status(400).json({ message: err.message || "Failed to update order status." });
    }
});

// Manual / Server WhatsApp Notification Trigger (GET and POST supported)
const handleNotifyWhatsApp = async (req, res) => {
    try {
        const { id } = req.params;
        const target = req.query.target || req.body?.target || 'all';
        const customType = req.query.type || req.body?.type || null;

        const order = await dataStore.getOrderById(id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        let eventType = customType;
        if (!eventType) {
            if (order.orderStatus === 'Dispatched') {
                eventType = 'Dispatched';
            } else if (order.orderStatus === 'Delivered') {
                eventType = 'Delivered';
            } else if (order.rider?.riderId || order.orderStatus === 'Ready to Dispatch') {
                eventType = 'Assigned';
            } else {
                eventType = order.orderStatus || 'Placed';
            }
        }

        const riderMobile = order.rider?.riderMobile || null;
        const customerMobile = order.customerMobile || order.addressDetails?.mobile || null;
        let sentCount = 0;
        const dispatchedTo = [];

        if ((target === 'all' || target === 'rider') && riderMobile) {
            try {
                await sendCustomWhatsAppAlert(order, eventType, riderMobile);
                sentCount++;
                dispatchedTo.push({ recipient: 'rider', mobile: riderMobile });
            } catch (err) {
                console.warn(`[WhatsApp Notify] Failed to notify rider for order ${id}:`, err.message);
            }
        }

        if ((target === 'all' || target === 'customer') && customerMobile) {
            try {
                await sendCustomWhatsAppAlert(order, eventType, customerMobile);
                sentCount++;
                dispatchedTo.push({ recipient: 'customer', mobile: customerMobile });
            } catch (err) {
                console.warn(`[WhatsApp Notify] Failed to notify customer for order ${id}:`, err.message);
            }
        }

        dataStore.logAudit(
            req.user?.sub || 'Admin',
            'WHATSAPP_NOTIFICATION_TRIGGERED',
            'ORDER',
            id,
            { target, eventType, dispatchedTo }
        );

        return res.json({
            success: true,
            message: sentCount > 0
                ? `WhatsApp notification dispatched for Order #${(order._id || id).toString().slice(-6).toUpperCase()} to ${dispatchedTo.map(d => d.recipient).join(' and ')}.`
                : `WhatsApp alert queued/recorded for Order #${(order._id || id).toString().slice(-6).toUpperCase()}.`,
            orderId: id,
            eventType,
            dispatchedTo
        });
    } catch (err) {
        console.error('WhatsApp notify error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Failed to dispatch WhatsApp notification' });
    }
};

router.get('/:id/notify-whatsapp', authenticateUser, isAdmin, handleNotifyWhatsApp);
router.post('/:id/notify-whatsapp', authenticateUser, isAdmin, handleNotifyWhatsApp);

// Admin All Orders
router.get('/admin/all', authenticateUser, isAdmin, async (req, res) => {
    try {
        if (isTenantOrderStaff(req)) {
            const tenantId = getActorTenantId(req);
            if (!tenantId) return res.status(403).json({ message: 'An active tenant context is required.' });
            const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
            const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
            if (req.query.fulfillmentSnapshot === 'true') {
                const snapshot = await dataStore.getFulfillmentSnapshot(page, limit, String(tenantId));
                for (const key of ['orders', 'items', 'recentOrders', 'latestOrders']) if (Array.isArray(snapshot?.[key])) await sanitizeTenantRiderReferences(snapshot[key]);
                return res.json(snapshot);
            }
            if (req.query.search !== undefined) {
                const { type, value } = classifyOrderSearch(req.query.search);
                const result = await dataStore.searchOrders({ type, value, page, limit, tenantId: String(tenantId) });
                await sanitizeTenantRiderReferences(result.items || []);
                return res.json({ ...paginationResult(result.items, result.total, result.page || 1, limit), searchType: type });
            }
            const filter = { tenantId: String(tenantId) };
            if (req.query.status) filter.$or = [
                { orderStatus: req.query.status },
                { status: String(req.query.status).toLowerCase() }
            ];
            if (req.query.status === 'Delivered' || req.query.status === 'Cancelled') {
                const result = req.query.status === 'Delivered'
                    ? await dataStore.getDeliveredOrdersPage(page, limit, {
                        tenantId: String(tenantId),
                        startDate: req.query.startDate,
                        endDate: req.query.endDate
                    })
                    : await dataStore.getCancelledOrdersPage(page, limit, { tenantId: String(tenantId) });
                await sanitizeTenantRiderReferences(result.items || []);
                return res.json(paginationResult(result.items, result.total, result.page || page, limit));
            }
            const orders = await Order.find(filter).sort({ createdAt: -1, _id: -1 }).lean().catch(() => []);
            await sanitizeTenantRiderReferences(orders);
            return res.json(orders);
        }
        if (isPlatformOrderAdmin(req) && req.query.tenantId) {
            const tenantId = String(req.query.tenantId);
            const selectedTenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean().catch(() => null);
            if (!selectedTenant && getIsConnected()) return res.status(404).json({ message: 'Active pharmacy tenant not found.' });
            const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
            const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
            if (req.query.fulfillmentSnapshot === 'true') {
                return res.json(await dataStore.getFulfillmentSnapshot(page, limit, tenantId));
            }
            if (req.query.search !== undefined) {
                const { type, value } = classifyOrderSearch(req.query.search);
                const result = await dataStore.searchOrders({ type, value, page, limit, tenantId });
                return res.json({ ...paginationResult(result.items, result.total, result.page || 1, limit), searchType: type });
            }
            const filter = { tenantId };
            if (req.query.status) filter.$or = [
                { orderStatus: req.query.status },
                { status: String(req.query.status).toLowerCase() }
            ];
            if (req.query.status === 'Delivered' || req.query.status === 'Cancelled') {
                const result = req.query.status === 'Delivered'
                    ? await dataStore.getDeliveredOrdersPage(page, limit, {
                        tenantId,
                        startDate: req.query.startDate,
                        endDate: req.query.endDate
                    })
                    : await dataStore.getCancelledOrdersPage(page, limit, { tenantId });
                await sanitizeTenantRiderReferences(result.items || []);
                return res.json(paginationResult(result.items, result.total, result.page || page, limit));
            }
            const [items, total] = await Promise.all([
                Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
                Order.countDocuments(filter)
            ]);
            await sanitizeTenantRiderReferences(items);
            return res.json(paginationResult(items, total, page, limit));
        }
        if (req.query.search !== undefined) {
            const { type, value } = classifyOrderSearch(req.query.search);
            const parsedPage = Number.parseInt(req.query.page, 10);
            const parsedLimit = Number.parseInt(req.query.limit, 10);
            const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
            const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10;
            const result = await dataStore.searchOrders({ type, value, page: requestedPage, limit });
            const page = result.page || 1;
            return res.json({ ...paginationResult(result.items, result.total, page, limit), searchType: type });
        }
        if (req.query.status !== undefined) {
            const parsedPage = Number.parseInt(req.query.page, 10);
            const parsedLimit = Number.parseInt(req.query.limit, 10);
            const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
            const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10;
            let result;
            if (req.query.status === 'Delivered') result = await dataStore.getDeliveredOrdersPage(requestedPage, limit, { startDate: req.query.startDate, endDate: req.query.endDate });
            else if (req.query.status === 'Cancelled') result = await dataStore.getCancelledOrdersPage(requestedPage, limit);
            else return res.status(400).json({ message: 'Only Delivered and Cancelled orders support pagination on this endpoint.' });
            return res.json(paginationResult(result.items, result.total, result.page || 1, limit));
        }
        if (req.query.fulfillmentSnapshot === 'true') {
            const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
            const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
            return res.json(await dataStore.getFulfillmentSnapshot(page, limit));
        }
        return res.json(await dataStore.getAllOrders());
    } catch (err) {
        const statusCode = getErrorStatus(err);
        console.error('[OrderRoutes] Admin order retrieval failed:', err);
        return res.status(statusCode).json({
            code: err.code || (statusCode === 503 ? 'ORDER_STORAGE_UNAVAILABLE' : 'ORDER_RETRIEVAL_FAILED'),
            message: statusCode === 503
                ? 'Order history is temporarily unavailable. Please try again.'
                : statusCode === 400
                    ? err.message
                    : 'Failed to retrieve orders.'
        });
    }
});

// Keep the static /mine route before /:id so Express does not
// treat "mine" as an order ID and return INVALID_ORDER_ID.
router.get('/mine', authenticateUser, async (req, res) => {
    try {
        const orders = await dataStore.getUserOrders(req.user.sub);
        await sanitizeTenantRiderReferences(orders);
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
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 3));
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
            .sort({ createdAt: -1, _id: -1 })
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .lean();
        await sanitizeTenantRiderReferences(orders);
        res.status(200).json({
            orders,
            items: orders,
            pagination: {
                page: currentPage,
                pageSize: limit,
                limit,
                total,
                totalPages,
                hasNextPage: currentPage < totalPages,
                hasPreviousPage: currentPage > 1
            }
        });
    } catch (err) {
        console.error('Order history retrieval failed:', err);
        res.status(500).json({ message: 'Failed to retrieve order history.' });
    }
});


// Customer/admin order detail used by the tracking UI.
router.get('/:id', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Order tracking is temporarily unavailable.' });
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order ID.' });
        const order = await Order.findById(req.params.id).lean();
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (!canTenantAccessOrder(req, order)) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        if (!isPlatformOrderAdmin(req)) await sanitizeTenantRiderReferences(order);
        return res.json({ success: true, order });
    } catch (error) {
        console.error('Order tracking retrieval failed:', error);
        return res.status(500).json({ message: 'Could not load the latest order tracking status.' });
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


// Retrieve delivery OTP from cache service (held for 1 day) or generate/sync with database
router.get('/:id/reveal-otp', authenticateUser, async (req, res) => {
    try {
        if (!getIsConnected() || !mongoose.isValidObjectId(req.params.id)) {
            return res.status(503).json({ message: 'Service unavailable.' });
        }
        const order = await Order.findById(req.params.id);
        if (!order || !canTenantAccessOrder(req, order)) return res.status(404).json({ message: 'Order not found.' });
        let cachedOtp = await cacheService.get(`delivery_otp:${req.params.id}`);
        if (cachedOtp) {
            return res.json({ otp: cachedOtp, source: 'cache_service_1_day' });
        }

        cachedOtp = String(randomInt(0, 10000)).padStart(4, '0');
        order.deliveryVerification = {
            otpHash: scryptSync(cachedOtp, String(order._id), 32).toString('hex'),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            attempts: 0,
            verifiedAt: null
        };
        await order.save();
        await cacheService.set(`delivery_otp:${req.params.id}`, cachedOtp, 86400);

        return res.json({ otp: cachedOtp, source: 'generated_and_cached' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Could not reveal OTP.' });
    }
});

// Regenerate and resend delivery OTP (cached for 1 day, notifies customer)
router.post('/:id/resend-otp', authenticateUser, async (req, res) => {
    try {
        if (!getIsConnected() || !mongoose.isValidObjectId(req.params.id)) {
            return res.status(503).json({ message: 'Service unavailable.' });
        }
        const order = await Order.findById(req.params.id);
        if (!order || !canTenantAccessOrder(req, order)) return res.status(404).json({ message: 'Order not found.' });
        if (order.orderStatus !== 'Dispatched') {
            return res.status(409).json({ message: 'Order must be out for delivery to resend OTP.' });
        }

        const newOtp = String(randomInt(0, 10000)).padStart(4, '0');
        order.deliveryVerification = {
            otpHash: scryptSync(newOtp, String(order._id), 32).toString('hex'),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            attempts: 0,
            verifiedAt: null
        };
        await order.save();
        await cacheService.set(`delivery_otp:${order._id}`, newOtp, 86400);

        try {
            await sendCustomWhatsAppAlert(order, 'Dispatched');
        } catch (whatsappErr) {
            console.warn('[WhatsApp] Resend OTP alert failed:', whatsappErr?.message);
        }

        return res.json({ success: true, message: 'New delivery OTP generated, cached for 24h, and sent to customer.', otp: newOtp });
    } catch (error) {
        console.error('Resend OTP failed:', error);
        return res.status(500).json({ message: error.message || 'Could not resend OTP.' });
    }
});

router.post('/:id/verify-delivery', authenticateUser, async (req, res) => {
    const role = String(req.user?.app_metadata?.role || req.user?.role || req.context?.role || 'customer').toUpperCase();
    const staffRoles = new Set(['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'ORDER_MANAGER', 'PHARMACY']);
    const platformStaff = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    try {
        if (!getIsConnected() || !mongoose.isValidObjectId(req.params.id)) {
            return res.status(503).json({ message: 'Delivery verification is temporarily unavailable.' });
        }
        const order = await Order.findById(req.params.id).select('+deliveryVerification.otpHash +deliveryVerification.expiresAt +deliveryVerification.attempts +deliveryVerification.verifiedAt');
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (order.orderStatus !== 'Dispatched') {
            return res.status(409).json({ message: 'The order must be out for delivery before it can be completed.' });
        }

        if (!order.tenantId) return res.status(404).json({ message: 'Order not found.' });
        const rider = await Rider.findOne({
            supabaseId: req.user.sub,
            tenantId: String(order.tenantId),
            enabled: true
        }).lean();
        if (rider) {
            if (!isAssignedRiderForOrder(rider, order)) {
                return res.status(403).json({ message: 'This delivery is not assigned to your rider account.' });
            }
        } else {
            if (!staffRoles.has(role)) return res.status(403).json({ message: 'Only the assigned rider can verify delivery.' });
            if (!platformStaff && !isSameTenant(getActorTenantId(req), order.tenantId)) {
                return res.status(404).json({ message: 'Order not found.' });
            }
            const requestedRiderId = String(req.body?.riderId || order.rider?.riderId || order.riderId || '');
            const assignedRiderId = String(order.rider?.riderId || order.riderId || '');
            if (!requestedRiderId || requestedRiderId !== assignedRiderId) {
                return res.status(403).json({ message: 'Only the rider assigned to this order can verify delivery.' });
            }
            const assignedRider = await Rider.findOne({
                _id: requestedRiderId,
                tenantId: String(order.tenantId),
                enabled: true
            }).select('_id').lean();
            if (!isAssignedRiderForOrder(assignedRider, order)) return res.status(404).json({ message: 'Assigned rider not found for this pharmacy.' });
        }

        const code = String(req.body?.otp || '').trim();
        if (!/^\d{4}$/.test(code)) return res.status(400).json({ message: 'Enter the 4-digit code shared by the customer.' });
        const verification = order.deliveryVerification || {};
        if (!verification.otpHash || !verification.expiresAt || new Date(verification.expiresAt) <= new Date()) {
            return res.status(409).json({ message: 'The delivery code is missing or expired. Ask the pharmacy to resend the out-for-delivery notification.' });
        }
        if (Number(verification.attempts || 0) >= 5) {
            return res.status(429).json({ message: 'Too many incorrect attempts. Ask the pharmacy to reissue the delivery code.' });
        }
        const candidateHash = scryptSync(code, String(order._id), 32).toString('hex');
        const storedHash = String(verification.otpHash);
        const matches = candidateHash.length === storedHash.length
            && timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'));
        if (!matches) {
            await Order.updateOne({
                _id: order._id,
                orderStatus: 'Dispatched',
                'deliveryVerification.verifiedAt': null,
                'deliveryVerification.attempts': { $lt: 5 }
            }, { $inc: { 'deliveryVerification.attempts': 1 } });
            return res.status(400).json({ message: 'The delivery code is incorrect. Check the customer’s code and try again.' });
        }

        const claimed = await Order.findOneAndUpdate({
            _id: order._id,
            orderStatus: 'Dispatched',
            'deliveryVerification.otpHash': storedHash,
            'deliveryVerification.verifiedAt': null,
            'deliveryVerification.expiresAt': { $gt: new Date() },
            'deliveryVerification.attempts': { $lt: 5 }
        }, { $set: { 'deliveryVerification.verifiedAt': new Date() } }, { new: true });
        if (!claimed) return res.status(409).json({ message: 'This delivery code has already been used, expired, or the order has changed.' });

        let deliveredOrder;
        try {
            deliveredOrder = await dataStore.transitionOrderStatus(
                String(order._id),
                'Delivered',
                rider?.name || req.user.user_metadata?.name || req.user.email || 'Assigned Rider',
                null,
                null,
                true
            );
        } catch (error) {
            await Order.updateOne({ _id: order._id, orderStatus: 'Dispatched' }, { $set: { 'deliveryVerification.verifiedAt': null } });
            throw error;
        }
        try {
            await sendCustomWhatsAppAlert(deliveredOrder, 'Delivered');
        } catch (notificationError) {
            console.warn('[WhatsApp] Delivery-complete notification failed:', notificationError?.message);
        }
        return res.json({ success: true, message: 'Delivery verified and order completed.', order: deliveredOrder });
    } catch (error) {
        console.error('Proof of delivery verification failed:', error);
        return res.status(getErrorStatus(error)).json({ message: error.message || 'Could not verify delivery.' });
    }
});


// Notification logs audit
router.get('/notifications/logs', authenticateUser, isAdmin, async (req, res) => {
    try {
        const logs = await getNotificationLog();
        if (isTenantOrderStaff(req)) {
            const tenantId = getActorTenantId(req);
            if (!tenantId) return res.status(403).json({ message: 'An active tenant context is required.' });
            const tenantOrders = await Order.find({ tenantId: String(tenantId) }).select('_id orderNumber').lean();
            const allowedOrderReferences = new Set(tenantOrders.flatMap(order => [String(order._id), String(order.orderNumber || '')]));
            return res.json(logs.filter(log => allowedOrderReferences.has(String(log.orderId || ''))));
        }
        return res.json(logs);
    } catch (err) {
        console.error("Notification log retrieval failed:", err);
        res.status(500).json({ message: "Failed to retrieve notification logs" });
    }
});

export default router;
, 'i');
                    else {
                        hasUnavailable = true;
                        lines.push({ ...line, allocatedQuantity: 0, notifiedAvailableQuantity: 0 });
                        continue;
                    }
                }
                const candidate = await Medicine.findOne(query).select('_id stockQuantity stock quantity reservedQuantity price').lean();
                const physical = Number(candidate?.stockQuantity ?? candidate?.stock ?? candidate?.quantity ?? 0);
                const available = candidate ? Math.max(0, physical - Number(candidate.reservedQuantity || 0)) : 0;
                const allocatedQuantity = Math.min(Number(line.waitingQuantity || line.requestedQuantity || 0), available);
                if (allocatedQuantity > 0) hasAvailable = true;
                else hasUnavailable = true;
                lines.push({
                    ...line,
                    productId: candidate?._id ? String(candidate._id) : line.productId,
                    allocatedQuantity,
                    notifiedAvailableQuantity: available,
                    unitPrice: Number(candidate?.price ?? line.unitPrice ?? 0)
                });
            }
            const nextStatus = hasAvailable ? (hasUnavailable ? 'PARTIALLY_FULFILLED' : 'READY_FOR_CONFIRMATION') : 'WAITING_FOR_STOCK';
            const becameReady = hasAvailable && !['READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'].includes(entry.status);
            const updated = await FulfillmentCase.findOneAndUpdate(
                { _id: entry._id, customerId: String(req.user.sub), status: entry.status },
                {
                    $set: { lines, status: nextStatus, lastAvailabilityCheckAt: now },
                    ...(becameReady ? { $push: { auditTrail: { action: 'STOCK_BECAME_AVAILABLE', actorId: 'system', at: now } } } : {})
                },
                { new: true }
            ).lean();
            const result = updated || entry;
            refreshed.push(result);
            if (becameReady) {
                domainEvents.emitDomainEvent('FULFILLMENT_STOCK_READY', String(entry._id), {
                    customerId: entry.customerId, caseNumber: entry.caseNumber,
                    availableLines: lines.filter(line => Number(line.allocatedQuantity) > 0).length
                }, null, entry.tenantId, entry.branchId);
            }
        }
        return res.json({ items: refreshed, checkedAt: now.toISOString() });
    } catch (error) {
        console.error('Stock waitlist refresh failed:', error);
        return res.status(503).json({ message: 'Unable to load and refresh your stock waitlist.' });
    }
});

router.post('/fulfillment/waitlist', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Stock waitlist is temporarily unavailable.' });
    let requestFingerprint = null;
    try {
        const tenantId = String(req.body?.tenantId || '').trim();
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (!tenantId || !items.length) return res.status(400).json({ message: 'Pharmacy and pending medicine items are required.' });
        if (!idempotencyKey || idempotencyKey.length > 128) return res.status(400).json({ message: 'A valid Idempotency-Key header is required.' });
        const { waitDays, waitUntil } = validateWaitWindow(req.body?.waitDays);
        const normalizedWaitItems = items.map(item => ({ productId: String(item.productId || item.medicineId || ''), requestedQuantity: Number(item.requestedQuantity ?? item.waitingQuantity) })).sort((a, b) => a.productId.localeCompare(b.productId));
        requestFingerprint = createHash('sha256').update(JSON.stringify({ tenantId, sourceType: req.body?.sourceType || 'CHECKOUT', sourceId: req.body?.sourceId || null, parentOrderId: req.body?.parentOrderId || null, waitDays, items: normalizedWaitItems })).digest('hex');
        const ids = [...new Set(items.map(item => String(item.productId || item.medicineId || '')).filter(Boolean))];
        if (!items.every(item => {
            const productId = String(item.productId || item.medicineId || '');
            const requestedName = String(item.requestedName || item.name || '').trim();
            const requestedQuantity = Number(item.requestedQuantity ?? item.waitingQuantity);
            return (productId ? mongoose.isValidObjectId(productId) : requestedName.length > 1)
                && Number.isSafeInteger(requestedQuantity) && requestedQuantity > 0;
        })) return res.status(400).json({ message: 'Each waitlist item needs a catalogue product or requested medicine name and a positive whole-number quantity.' });
        const tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!tenant) return res.status(404).json({ message: 'Selected pharmacy is unavailable.' });
        const existing = await FulfillmentCase.findOne({ customerId: String(req.user.sub), tenantId, idempotencyKey }).lean();
        if (existing) return res.status(200).json({ case: existing, alreadyCreated: true });
        const inventory = ids.length ? await Medicine.find({ _id: { $in: ids }, tenantId }).select('_id name').lean() : [];
        if (inventory.length !== ids.length) return res.status(404).json({ message: 'One or more selected medicines are not listed by this pharmacy.' });
        const lines = items.map(item => {
            const productId = String(item.productId || item.medicineId || '');
            const requestedQuantity = Number(item.requestedQuantity ?? item.waitingQuantity);
            const product = productId ? inventory.find(row => String(row._id) === productId) : null;
            return {
                productId: productId || null,
                name: product?.name || String(item.requestedName || item.name || '').trim(),
                requestedName: String(item.requestedName || item.name || product?.name || '').trim(),
                composition: String(item.composition || '').trim(),
                strength: String(item.strength || '').trim(),
                dosageForm: String(item.dosageForm || '').trim(),
                requestedQuantity,
                allocatedQuantity: 0, waitingQuantity: requestedQuantity,
                customerDecision: 'ACCEPTED_ORIGINAL'
            };
        });
        const caseNumber = 'FUL-' + randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
        const created = await FulfillmentCase.create({
            caseNumber, customerId: String(req.user.sub), tenantId,
            branchId: req.body?.branchId || req.user?.branchId || req.user?.app_metadata?.branchId || null,
            sourceType: req.body?.sourceType === 'MEDICINE_REQUEST' ? 'MEDICINE_REQUEST' : 'CHECKOUT',
            sourceId: req.body?.sourceId ? String(req.body.sourceId) : null,
            parentOrderId: req.body?.parentOrderId ? String(req.body.parentOrderId) : null,
            addressId: req.body?.addressId || null,
            deliveryAddress: String(req.body?.deliveryAddress || '').trim(),
            addressDetails: req.body?.addressDetails || {},
            coordinates: req.body?.coordinates || null,
            paymentMethod: req.body?.paymentMethod || 'Cash on Delivery (COD)',
            prescriptionUrl: req.body?.prescriptionUrl || null,
            prescriptionId: req.body?.prescriptionId || null,
            patientPuid: req.body?.patientPuid || null,
            status: 'WAITING_FOR_STOCK', lines, waitDays, waitUntil,
            idempotencyKey, requestFingerprint,
            auditTrail: [{ action: 'WAITLIST_CREATED', actorId: String(req.user.sub), at: new Date(), waitDays, waitUntil }]
        });
        if (created.parentOrderId) {
            await Order.updateOne({ _id: created.parentOrderId, userId: String(req.user.sub), tenantId }, { $set: { fulfillmentCaseId: String(created._id), fulfillmentState: 'PARTIAL' } });
        }
        return res.status(201).json({ case: created.toObject(), message: 'Your stock waitlist request has been saved.' });
    } catch (error) {
        if (error.code === 11000) {
            const existing = await FulfillmentCase.findOne({ customerId: String(req.user.sub), tenantId: String(req.body?.tenantId || ''), idempotencyKey: String(req.get('Idempotency-Key') || '') }).lean();
            if (existing && existing.requestFingerprint === requestFingerprint) return res.status(200).json({ case: existing, alreadyCreated: true });
        }
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to save stock waitlist request.' });
    }
});


router.post('/fulfillment/waitlist/:id/confirm', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Stock waitlist confirmation is temporarily unavailable.' });
    let claimed = null;
    const confirmationId = randomUUID();
    const finalize = async order => {
        const confirmationLines = claimed.confirmationLines || [];
        const remainingLines = (claimed.lines || []).map(line => {
            const confirmed = confirmationLines.find(item => String(item.productId) === String(line.productId));
            const allocated = Math.min(Number(confirmed?.allocatedQuantity || 0), Number(line.waitingQuantity || 0));
            return {
                ...line,
                requestedQuantity: Math.max(0, Number(line.waitingQuantity || 0) - allocated),
                allocatedQuantity: 0,
                waitingQuantity: Math.max(0, Number(line.waitingQuantity || 0) - allocated),
                notifiedAvailableQuantity: 0
            };
        }).filter(line => line.requestedQuantity > 0);
        const updated = await FulfillmentCase.updateOne({
            _id: claimed._id, customerId: String(req.user.sub),
            status: 'CONFIRMING', confirmationId
        }, {
            $set: {
                lines: remainingLines,
                status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'FULFILLED',
                parentOrderId: String(order._id),
                confirmationId: null, confirmingAt: null,
                confirmationPreviousStatus: null, confirmationLines: [],
                lastAvailabilityCheckAt: new Date()
            },
            $push: { auditTrail: { action: 'AVAILABLE_STOCK_CONFIRMED', actorId: String(req.user.sub), at: new Date(), orderId: String(order._id), fulfilledLineCount: confirmationLines.length } }
        });
        if (!updated.modifiedCount) {
            throw Object.assign(new Error('Order was created, but the waitlist update is still being reconciled. Refresh your waitlist shortly.'), { statusCode: 202 });
        }
        if (claimed.parentOrderId) {
            await Order.updateOne({ _id: claimed.parentOrderId, userId: String(req.user.sub), tenantId: claimed.tenantId }, {
                $set: { fulfillmentState: remainingLines.length ? 'PARTIAL' : 'COMPLETE' }
            });
        }
        if (claimed.sourceType === 'MEDICINE_REQUEST' && claimed.sourceId) {
            await MedicineRequest.updateOne({ _id: claimed.sourceId, customerId: String(req.user.sub), fulfillmentCaseId: String(claimed._id) }, {
                $set: { status: remainingLines.length ? 'WAITING_FOR_STOCK' : 'CONVERTED_TO_ORDER', convertedOrderId: String(order._id) },
                $push: { auditTrail: { action: 'WAITLIST_STOCK_ORDER_CREATED', actorId: String(req.user.sub), role: 'Customer', timestamp: new Date(), notes: `Created order ${String(order._id)} from available waitlist stock.` } }
            });
        }
        return { order, remainingLines };
    };
    try {
        const initial = await FulfillmentCase.findOne({
            _id: req.params.id, customerId: String(req.user.sub),
            status: { $in: ['READY_FOR_CONFIRMATION', 'PARTIALLY_FULFILLED'] },
            waitUntil: { $gt: new Date() }
        }).lean();
        if (!initial) return res.status(404).json({ message: 'No active stock-ready waitlist entry was found.' });
        if (!initial.addressId || !initial.deliveryAddress || !hasValidCoordinates(initial.coordinates)) {
            return res.status(409).json({ message: 'Please update a verified delivery address before confirming this stock-ready request.' });
        }
        const confirmationLines = (initial.lines || []).filter(line => Number(line.allocatedQuantity || 0) > 0);
        if (!confirmationLines.length) return res.status(409).json({ message: 'No requested quantity is currently available.' });
        claimed = await FulfillmentCase.findOneAndUpdate({
            _id: initial._id, customerId: String(req.user.sub),
            status: initial.status, waitUntil: { $gt: new Date() }
        }, {
            $set: {
                status: 'CONFIRMING',
                confirmationId,
                confirmingAt: new Date(),
                confirmationPreviousStatus: initial.status,
                confirmationLines
            },
            $push: { auditTrail: { action: 'STOCK_CONFIRMATION_STARTED', actorId: String(req.user.sub), at: new Date(), confirmationId } }
        }, { new: true }).lean();
        if (!claimed) return res.status(409).json({ message: 'Another confirmation is already in progress. Refresh your waitlist.' });
        try {
            const order = await dataStore.reserveOrder({
                userId: String(req.user.sub), tenantId: claimed.tenantId, branchId: claimed.branchId,
                addressId: claimed.addressId, deliveryAddress: claimed.deliveryAddress,
                addressDetails: claimed.addressDetails || {}, coordinates: claimed.coordinates,
                paymentMethod: claimed.paymentMethod || 'Cash on Delivery (COD)',
                source: claimed.sourceType === 'MEDICINE_REQUEST' ? 'MEDICINE_REQUEST' : 'WEB',
                fulfillmentCaseId: String(claimed._id),
                fulfillmentConfirmationId: confirmationId,
                prescriptionUrl: claimed.prescriptionUrl || null, prescriptionId: claimed.prescriptionId || null,
                patientPuid: claimed.patientPuid || null,
                items: confirmationLines.map(line => ({ medicineId: line.productId, quantity: Number(line.allocatedQuantity) }))
            }, 'Customer stock waitlist confirmation');
            const completed = await finalize(order);
            return res.status(201).json({ order: completed.order, waitlistCaseId: String(claimed._id), remainingItems: completed.remainingLines, message: 'Available stock has been reserved and a new order has been created.' });
        } catch (confirmationError) {
            const existingOrder = await Order.findOne({ fulfillmentConfirmationId: confirmationId }).lean();
            if (existingOrder) {
                const completed = await finalize(existingOrder);
                return res.status(201).json({ order: completed.order, waitlistCaseId: String(claimed._id), remainingItems: completed.remainingLines, message: 'Your stock reservation was completed and reconciled.' });
            }
            await FulfillmentCase.updateOne({ _id: claimed._id, customerId: String(req.user.sub), status: 'CONFIRMING', confirmationId }, {
                $set: {
                    status: claimed.confirmationPreviousStatus || 'WAITING_FOR_STOCK',
                    confirmationId: null, confirmingAt: null,
                    confirmationPreviousStatus: null, confirmationLines: []
                },
                $push: { auditTrail: { action: 'STOCK_CONFIRMATION_FAILED', actorId: String(req.user.sub), at: new Date(), notes: confirmationError.message } }
            });
            throw confirmationError;
        }
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to confirm available stock.' });
    }
});

router.post('/fulfillment/waitlist/:id/cancel', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Stock waitlist is temporarily unavailable.' });
    try {
        const updated = await FulfillmentCase.findOneAndUpdate({
            _id: req.params.id, customerId: String(req.user.sub),
            status: { $in: ['WAITING_FOR_STOCK', 'AWAITING_CUSTOMER_DECISION', 'READY_FOR_CONFIRMATION'] }
        }, {
            $set: { status: 'CANCELLED' },
            $push: { auditTrail: { action: 'WAITLIST_CANCELLED', actorId: String(req.user.sub), at: new Date() } }
        }, { new: true }).lean();
        if (!updated) return res.status(404).json({ message: 'Active stock waitlist entry not found.' });
        if (updated.parentOrderId) await Order.updateOne({ _id: updated.parentOrderId, userId: String(req.user.sub), tenantId: updated.tenantId }, { $set: { fulfillmentState: 'PARTIAL' } });
        if (updated.sourceType === 'MEDICINE_REQUEST' && updated.sourceId) {
            await MedicineRequest.updateOne({ _id: updated.sourceId, customerId: String(req.user.sub), fulfillmentCaseId: String(updated._id) }, {
                $set: { status: 'CANCELLED' },
                $push: { auditTrail: { action: 'WAITLIST_CANCELLED', actorId: String(req.user.sub), role: 'Customer', timestamp: new Date(), notes: 'Customer cancelled the stock waitlist.' } }
            });
        }
        return res.json({ case: updated, message: 'Stock waitlist entry cancelled.' });
    } catch {
        return res.status(503).json({ message: 'Unable to cancel stock waitlist entry.' });
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
        const selectedTenantId = String(req.body.tenantId || '').trim();
        if (!selectedTenantId) {
            return res.status(400).json({ code: 'PHARMACY_SELECTION_REQUIRED', message: 'Select a pharmacy before placing your order.' });
        }
        if (!getIsConnected()) {
            return res.status(503).json({ message: 'Pharmacy verification is unavailable. No order was created.' });
        }
        const selectedTenant = await Tenant.findOne({ _id: selectedTenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!selectedTenant) {
            return res.status(404).json({ code: 'PHARMACY_UNAVAILABLE', message: 'The selected pharmacy is no longer available. Please choose another pharmacy.' });
        }
        const cartItems = parseCheckoutItems(req.body.items || req.body.cartItems);
        if (!Array.isArray(cartItems) || !cartItems.length) {
            return res.status(400).json({ message: 'Add at least one medicine to your order.' });
        }
        
        let chosenAddressLine = deliveryAddress;
        let chosenCoords = coordinates;
        if (typeof chosenCoords === 'string') {
            try { chosenCoords = JSON.parse(chosenCoords); } catch {}
        }

        let addressSnapshot = null;
        if (addressId) {
            addressSnapshot = await dataStore.getUserAddress(req.user.sub, addressId);
            if (addressSnapshot) {
                chosenAddressLine = addressSnapshot.addressLine || `${addressSnapshot.addressLine1}, ${addressSnapshot.city} - ${addressSnapshot.pincode}`;
                chosenCoords = addressSnapshot.coordinates || chosenCoords;
            } else if (!chosenAddressLine?.trim() || !hasValidCoordinates(chosenCoords)) {
                return res.status(400).json({ message: "Selected delivery address was not found. Refresh your address list and try again." });
            }
        }

        if (!chosenAddressLine?.trim() || !hasValidCoordinates(chosenCoords)) {
            return res.status(400).json({ message: 'A delivery address with a confirmed map pin is required to place an order.' });
        }

        const customerName = req.user.user_metadata?.name || req.user.email?.split('@')[0] || "Customer";
        if (prescriptionUrl && !prescriptionUrl.startsWith('/api/orders/prescriptions/')) {
            return res.status(400).json({ message: 'Prescription URL must refer to a private uploaded prescription.' });
        }
        let uploadedPrescriptionId = null;
        let orderedForPerson = null;
        const requestedPatientPuid = String(req.body.patientPuid || '').trim();
        if (requestedPatientPuid) {
            try {
                orderedForPerson = await customerService.getManagedPerson(req.user.sub, requestedPatientPuid);
            } catch (error) {
                return res.status(error.statusCode || 403).json({
                    message: 'The selected customer or relative profile is not managed by this account.'
                });
            }
        } else {
            try {
                const customer = await customerService.ensureCustomerForUser(req.user.sub, {
                    name: customerName,
                    email: req.user.email || ''
                });
                orderedForPerson = await customerService.getManagedPerson(req.user.sub, customer.selfPuid);
            } catch (error) {
                return res.status(error.statusCode || 503).json({
                    message: 'Your customer identity could not be verified. Please refresh your profile and try again.'
                });
            }
        }
        if (req.file) {
            uploadedPrescriptionUrl = await savePrescription(req.file, req.user.sub, selectedTenantId);
            if (prescriptionClient.isConfigured()) {
                try {
                    const uploaded = await prescriptionClient.upload({
                        buffer: req.file.buffer,
                        filename: req.file.originalname,
                        contentType: req.file.mimetype,
                        idempotencyKey: req.get('Idempotency-Key') || null,
                        userId: req.user.sub,
                        tenantId: req.user.tenantId || req.user.app_metadata?.tenantId || null,
                        branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
                        role: req.user?.app_metadata?.role || req.user?.role || 'customer',
                        patientPuid: orderedForPerson?.puid || req.body.patientPuid || null,
                        orderId: null
                    });
                    uploadedPrescriptionId = uploaded?.prescriptionId || null;
                    if (uploadedPrescriptionId) {
                        uploadedPrescriptionUrl = `/api/v1/prescriptions/${encodeURIComponent(uploadedPrescriptionId)}/document`;
                    }
                } catch (clientErr) {
                    console.warn('PrescriptionClient upload warning, continuing with stored prescription:', clientErr.message);
                }
            }
        } else {
            uploadedPrescriptionUrl = prescriptionUrl || null;
        }
        if (prescriptionUrl && !req.file) {
            const existingPrescription = await getPrescription(prescriptionUrl.split('/').at(-1));
            if (!existingPrescription || existingPrescription.ownerId !== req.user.sub) {
                return res.status(403).json({ message: 'The uploaded prescription does not belong to this account.' });
            }
        }

        const order = await dataStore.reserveOrder({
            userId: req.user.sub,
            tenantId: selectedTenantId,
            branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
            addressId: addressSnapshot?._id || addressId || null,
            customerName,
            customerMobile: addressSnapshot?.mobile || req.body.mobile || req.body.addressDetails?.mobile || req.body.addressDetails?.phone || req.user.user_metadata?.mobile || '',
            items: cartItems,
            pointsToRedeem,
            couponCode,
            prescriptionUrl: uploadedPrescriptionUrl,
            prescriptionId: uploadedPrescriptionId,
            patientPuid: orderedForPerson.puid,
            orderedForName: orderedForPerson.displayName,
            orderedForRelationship: orderedForPerson.relationshipToOwner || 'SELF',
            deliveryAddress: chosenAddressLine,
            addressDetails: addressSnapshot ? {
                label: addressSnapshot.label,
                fullName: addressSnapshot.fullName,
                mobile: addressSnapshot.mobile,
                addressLine1: addressSnapshot.addressLine1,
                addressLine2: addressSnapshot.addressLine2,
                city: addressSnapshot.city,
                state: addressSnapshot.state,
                postalCode: addressSnapshot.postalCode || addressSnapshot.pincode || '',
                pincode: addressSnapshot.pincode,
                country: addressSnapshot.country || 'India',
                landmark: addressSnapshot.landmark,
                coordinates: addressSnapshot.coordinates
            } : {},
            coordinates: chosenCoords,
            paymentMethod: paymentMethod || "Cash on Delivery (COD)"
        }, customerName);

        if (uploadedPrescriptionId && order?._id) {
            try {
                await prescriptionClient.linkOrder(uploadedPrescriptionId, order._id, {
                    userId: req.user.sub,
                    tenantId: req.user.tenantId || req.user.app_metadata?.tenantId || null,
                    branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
                    role: req.user?.app_metadata?.role || req.user?.role || 'customer'
                });
            } catch (conversionError) {
                console.error('Prescription-to-order association failed after order creation:', conversionError);
            }
        }

        // Automated messaging trigger
        await sendCustomWhatsAppAlert(order, 'Placed');

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
        const selectedTenantId = String(req.body?.tenantId || '').trim();
        if (!selectedTenantId) {
            return res.status(400).json({
                code: 'PHARMACY_SELECTION_REQUIRED',
                message: 'Select a pharmacy before calculating reward points.'
            });
        }
        const items = parseCheckoutItems(req.body.items || req.body.cartItems);
        const pointsToRedeem = Number(req.body.pointsToRedeem || 0);
        if (!Number.isSafeInteger(pointsToRedeem) || pointsToRedeem < 0) {
            return res.status(400).json({ message: 'Points to redeem must be a non-negative whole number.' });
        }
        const quote = await dynamicOrderService.evaluateCheckout(
            items,
            req.user.sub,
            pointsToRedeem,
            { couponCode: req.body.couponCode || undefined, tenantId: selectedTenantId }
        );
        return res.json(quote);
    } catch (error) {
        console.error('Checkout reward quote failed:', error);
        return res.status(getErrorStatus(error)).json({
            message: error.message || 'Unable to calculate the reward quote.'
        });
    }
});

// Prescription uploads are private files backed by MongoDB GridFS when configured.
router.get('/prescriptions/:fileId', authenticateUser, async (req, res) => {
    try {
        const prescription = await getPrescription(req.params.fileId);
        if (!prescription) return res.status(404).json({ message: 'Prescription file not found.' });
        const role = req.user?.app_metadata?.role || req.user?.role || 'customer';
        const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
        const normalizedRoles = new Set([role, ...roles].map(value => String(value || '').toUpperCase()));
        const globalAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].some(value => normalizedRoles.has(value));
        const tenantStaff = [
            'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACY', 'PHARMACIST',
            'PHARMACY_STAFF', 'BRANCH_ADMIN'
        ].some(value => normalizedRoles.has(value));
        const tenantId = req.user?.tenantId || req.user?.app_metadata?.tenantId || null;
        const branchId = req.user?.branchId || req.user?.app_metadata?.branchId || null;

        let relatedOrder = null;
        if (prescription.ownerId !== req.user.sub && !globalAdmin && tenantStaff) {
            const prescriptionUrl = `/api/orders/prescriptions/${req.params.fileId}`;
            if (getIsConnected()) {
                relatedOrder = await Order.findOne({
                    $or: [{ prescriptionUrl }, { prescriptionId: req.params.fileId }]
                }).select('tenantId branchId userId customerId').lean();
            } else {
                const orders = await dataStore.getAllOrders();
                relatedOrder = orders.find(order =>
                    order.prescriptionUrl === prescriptionUrl || String(order.prescriptionId || '') === String(req.params.fileId)
                ) || null;
            }
        }
        const tenantMatches = Boolean(tenantId && prescription.tenantId && String(tenantId) === String(prescription.tenantId)
            && relatedOrder?.tenantId && String(tenantId) === String(relatedOrder.tenantId));
        const branchMatches = !branchId || Boolean(relatedOrder?.branchId && String(branchId) === String(relatedOrder.branchId));
        const isAuthorizedStaff = globalAdmin || (tenantStaff && tenantMatches && branchMatches);

        if (prescription.ownerId !== req.user.sub && !isAuthorizedStaff) {
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

// Verify the actual prescription against the order's included medicines.
router.get(['/prescriptions/:fileId/scan', '/:id/scan-prescription'], authenticateUser, async (req, res) => {
    try {
        const order = await dataStore.getOrderById(req.params.id || req.params.fileId);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

        if (!canTenantAccessOrder(req, order)) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        if (!order.prescriptionRequired) {
            return res.json({
                success: true,
                verified: true,
                status: 'NOT_REQUIRED',
                confidence: 1,
                scannedMedicines: [],
                issues: []
            });
        }

        if (!order.prescriptionId) {
            return res.status(409).json({
                success: false,
                verified: false,
                status: 'REVIEW_REQUIRED',
                confidence: 0,
                scannedMedicines: [],
                issues: ['Order does not have a linked Python Prescription Service record.']
            });
        }

        await reinitiatePrescriptionProcessing({
            prescriptionId: order.prescriptionId,
            userId: req.user.sub,
            role: 'admin',
            isAdmin: true
        });

        const verification = await verifyPrescriptionAgainstItems({
            prescriptionId: order.prescriptionId,
            patientPuid: order.patientPuid || null,
            items: (order.items || order.medicineItems || []).map(item => ({
                productId: item.productId || item.medicineId || null,
                name: item.productName || item.name || '',
                productName: item.productName || item.name || '',
                strength: item.strength || '',
                form: item.form || item.dosageForm || '',
                quantity: Number(item.quantity || 0)
            })),
            userId: req.user.sub,
            tenantId: order.tenantId || req.user.tenantId || null,
            branchId: order.branchId || req.user.branchId || null,
            isAdmin: admin
        });

        return res.json({
            success: true,
            verified: verification.status === 'MATCHED',
            status: verification.status,
            confidence: Number(verification.overallConfidence || 0),
            scannedMedicines: verification.medicines || [],
            issues: verification.issues || [],
            verifiedAt: verification.lastCheckedAt || new Date().toISOString()
        });
    } catch (err) {
        console.error('Prescription verification failed:', err);
        return res.status(err.statusCode || 503).json({
            success: false,
            message: err.message || 'Failed to verify prescription.'
        });
    }
});;

router.put('/:id/review', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { status, decision, prescriptionVerified } = req.body;
        const reviewDecision = status || decision;
        if (!['Approved', 'Rejected'].includes(reviewDecision)) {
            return res.status(400).json({ message: 'Review status must be Approved or Rejected.' });
        }

        let order = await dataStore.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found.' });

        if (!canTenantAccessOrder(req, order)) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        if (reviewDecision === 'Approved' && order.prescriptionRequired) {
            if (!order.prescriptionId) {
                return res.status(409).json({
                    message: 'This order requires a Prescription Service record before approval.'
                });
            }

            // A pharmacist/admin may explicitly approve after reviewing the document.
            // Do not call the automated verifier again for an already recorded manual approval.
            if (order.prescriptionVerification?.status === 'MATCHED'
                && order.prescriptionVerification?.manualApproval === true) {
                // Manual approval is authoritative for this reviewed order.
            } else {
                const verification = await verifyPrescriptionAgainstItems({
                prescriptionId: order.prescriptionId,
                patientPuid: order.patientPuid || null,
                items: (order.items || order.medicineItems || []).map(item => ({
                    productId: item.productId || item.medicineId || null,
                    name: item.productName || item.name || '',
                    productName: item.productName || item.name || '',
                    strength: item.strength || '',
                    form: item.form || item.dosageForm || '',
                    quantity: Number(item.quantity || 0)
                })),
                userId: req.user.sub,
                tenantId: order.tenantId || req.user.tenantId || null,
                branchId: order.branchId || req.user.branchId || null,
                isAdmin: true
            });
            if (verification.status !== 'MATCHED') {
                return res.status(409).json({
                    message: 'Prescription verification must match all included medicines before order approval.',
                    verification
                });
            }
                if (getIsConnected() && order._id) {
                    await Order.findByIdAndUpdate(order._id, {
                        $set: {
                            prescriptionVerification: verification,
                            prescriptionId: verification.prescriptionId || order.prescriptionId,
                            patientPuid: verification.patientPuid || order.patientPuid || null
                        }
                    });
                }
            }
        }

        order = await dataStore.reviewOrder(
            req.params.id,
            reviewDecision === 'Approved' ? 'approve' : 'reject',
            req.user.user_metadata?.name || req.user.email || 'Admin'
        );

        let assignmentMessage = '';
        if (reviewDecision === 'Approved') {
            try {
                deliveryContainer.refreshDataLayer();
                const result = await deliveryContainer.assignmentEngine.assignOrder(String(order._id), { tenantId: order.tenantId });
                if (result.success) {
                    order = result.order.toJSON ? result.order.toJSON() : result.order;
                    assignmentMessage = ` Rider ${result.rider.name} was assigned automatically.`;
                    try {
                        await sendCustomWhatsAppAlert(order, 'Assigned', result.rider.mobile);
                    } catch (notificationError) {
                        console.warn(`[WhatsApp] Assignment notification failed for order ${order._id}:`, notificationError.message);
                    }
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

router.post('/admin/:id/prescription/reinitiate', authenticateUser, isAdmin, async (req, res) => {
    try {
        const order = await dataStore.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (!order.prescriptionRequired) {
            return res.status(400).json({ message: 'This order does not require prescription verification.' });
        }

        const items = (order.items || order.medicineItems || []).map(item => ({
            productId: item.productId || item.medicineId || null,
            name: item.productName || item.name || '',
            productName: item.productName || item.name || '',
            strength: item.strength || '',
            form: item.form || item.dosageForm || '',
            quantity: Number(item.quantity || 0)
        }));

        if (!order.prescriptionId) {
            return res.status(409).json({
                code: 'PRESCRIPTION_NOT_LINKED',
                message: 'No Prescription Service record is linked to this order. Manual approval is required.'
            });
        }

        // Re-enqueue the durable Prescription Service job first. Verification
        // alone only reads the current PROCESSING/REVIEW_REQUIRED snapshot and
        // cannot restart a stuck OCR/extraction job.
        const reprocessResult = await reinitiatePrescriptionProcessing({
            prescriptionId: order.prescriptionId,
            userId: req.user.sub,
            role: 'admin',
            isAdmin: true
        });

        const verification = await verifyPrescriptionAgainstItems({
            prescriptionId: order.prescriptionId,
            patientPuid: order.patientPuid || null,
            items,
            userId: req.user.sub,
            role: 'admin',
            isAdmin: true
        });

        if (getIsConnected() && order._id) {
            await Order.findByIdAndUpdate(order._id, {
                $set: {
                    prescriptionVerification: verification,
                    'fulfillmentGate.prescription': verification.status === 'MATCHED' ? 'APPROVED' : 'PENDING_REVIEW'
                },
                $push: {
                    statusHistory: {
                        previousStatus: order.orderStatus,
                        newStatus: order.orderStatus,
                        changedBy: req.user.user_metadata?.name || req.user.email || 'Admin',
                        timestamp: new Date(),
                        notes: 'Prescription verification re-initiated by admin.'
                    }
                }
            });
        }

        return res.json({
            success: true,
            message: verification.status === 'MATCHED'
                ? 'Prescription verification completed successfully.'
                : 'Prescription processing was re-queued. Refresh this order after extraction completes, or use manual review after opening the uploaded prescription.',
            processing: reprocessResult?.status || reprocessResult?.state || 'QUEUED',
            verification
        });
    } catch (err) {
        console.error('Prescription re-initiation failed:', err);
        return res.status(getErrorStatus(err)).json({ message: err.message || 'Could not re-initiate prescription verification.' });
    }
});

router.post('/admin/:id/prescription/manual-approve', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { scope = 'order', itemIndex, reason = '' } = req.body || {};
        const order = await dataStore.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (!order.prescriptionRequired) {
            return res.status(400).json({ message: 'This order does not require prescription approval.' });
        }
        if (!order.prescriptionUrl && !order.prescriptionId) {
            return res.status(409).json({ message: 'Manual approval is blocked because no prescription document is attached to this order.' });
        }
        const decisionReason = String(reason || '').trim();
        if (!decisionReason) {
            return res.status(400).json({ message: 'A pharmacist decision note is required for manual prescription approval.' });
        }
        if (scope === 'medicine' && (!Number.isInteger(Number(itemIndex)) || Number(itemIndex) < 0)) {
            return res.status(400).json({ message: 'A valid medicine itemIndex is required.' });
        }

        const items = order.items || order.medicineItems || [];
        if (scope === 'medicine' && Number(itemIndex) >= items.length) {
            return res.status(400).json({ message: 'Medicine item was not found in this order.' });
        }

        const existingVerification = order.prescriptionVerification || {};
        const existingMedicines = Array.isArray(existingVerification.medicines)
            ? existingVerification.medicines
            : [];
        const medicines = items.map((item, index) => {
            const current = existingMedicines[index] || {};
            const shouldApprove = scope === 'order' || index === Number(itemIndex);
            return {
                ...current,
                orderMedicine: current.orderMedicine || item.productName || item.name || item.genericName || 'Medicine',
                productId: current.productId || item.productId || item.medicineId || null,
                status: shouldApprove ? 'MATCHED' : (current.status || 'REVIEW_REQUIRED'),
                manualApproved: shouldApprove ? true : Boolean(current.manualApproved),
                manualApprovedBy: shouldApprove
                    ? (req.user.user_metadata?.name || req.user.email || 'Admin')
                    : current.manualApprovedBy,
                manualApprovedAt: shouldApprove ? new Date().toISOString() : current.manualApprovedAt,
                manualApprovalReason: shouldApprove ? decisionReason.slice(0, 500) : current.manualApprovalReason
            };
        });

        const allMedicinesApproved = medicines.length > 0 && medicines.every(medicine => medicine.manualApproved === true);
        const verification = {
            ...existingVerification,
            status: allMedicinesApproved ? 'MATCHED' : 'REVIEW_REQUIRED',
            prescriptionId: order.prescriptionId || existingVerification.prescriptionId || null,
            patientPuid: order.patientPuid || existingVerification.patientPuid || null,
            overallConfidence: allMedicinesApproved ? 1 : Number(existingVerification.overallConfidence || 0),
            lastCheckedAt: new Date(),
            medicines,
            issues: allMedicinesApproved ? [] : ['One or more medicines still require manual approval.'],
            manualApproval: true,
            manualApprovalScope: scope,
            manualApprovedBy: req.user.user_metadata?.name || req.user.email || 'Admin',
            manualApprovalAt: new Date(),
            manualApprovalReason: decisionReason.slice(0, 500)
        };

        if (getIsConnected() && order._id) {
            await Order.findByIdAndUpdate(order._id, {
                $set: {
                    prescriptionVerification: verification,
                    'fulfillmentGate.prescription': allMedicinesApproved ? 'APPROVED' : 'PENDING_REVIEW'
                },
                $push: {
                    statusHistory: {
                        previousStatus: order.orderStatus,
                        newStatus: order.orderStatus,
                        changedBy: req.user.user_metadata?.name || req.user.email || 'Admin',
                        timestamp: new Date(),
                        notes: `Manual prescription decision (${scope}): ${decisionReason.slice(0, 500)}`
                    }
                }
            });
        }

        return res.json({
            success: true,
            message: allMedicinesApproved
                ? 'All prescription medicines approved. Order is now eligible for fulfillment.'
                : 'Medicine manually approved. Remaining medicines still require review.',
            verification
        });
    } catch (err) {
        console.error('Manual prescription approval failed:', err);
        return res.status(getErrorStatus(err)).json({ message: err.message || 'Manual prescription approval failed.' });
    }
});

router.put('/:id/dispatch', authenticateUser, isAdmin, async (req, res) => {
    try {
        const targetOrder = await Order.findById(req.params.id).select('_id tenantId').lean();
        if (!targetOrder) return res.status(404).json({ message: 'Order not found.' });
        if (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || '')) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        const riderInfo = await resolveDispatchRider(req.body.riderInfo?.riderId, req.params.id, targetOrder.tenantId);
        const order = await dataStore.dispatchOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Admin',
            riderInfo
        );
        await sendCustomWhatsAppAlert(order, 'Dispatched', order.rider?.riderMobile);
        res.json({ message: 'Order dispatched and reserved inventory deducted.', order });
    } catch (err) {
        console.error('Order dispatch failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to dispatch order.' });
    }
});

router.post('/admin/:id/auto-assign', authenticateUser, isAdmin, async (req, res) => {
    try {
        if (!getIsConnected()) {
            return res.status(503).json({ message: 'Auto-assignment requires an active MongoDB connection.' });
        }
        deliveryContainer.refreshDataLayer();
        const orderId = req.params.id;
        const targetOrder = await Order.findById(orderId).select('_id tenantId').lean();
        if (!targetOrder || (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || ''))) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        const result = await deliveryContainer.assignmentEngine.assignOrder(orderId, { tenantId: targetOrder.tenantId });
        if (!result.success) {
            return res.status(404).json({
                success: false,
                message: result.reason || 'No available rider found for automatic assignment. Please assign manually.'
            });
        }
        const updatedOrder = result.order.toJSON ? result.order.toJSON() : result.order;
        try {
            await sendCustomWhatsAppAlert(updatedOrder, 'Assigned', result.rider.mobile);
        } catch (notificationError) {
            console.warn(`[WhatsApp] Auto-assign notification failed for order ${orderId}:`, notificationError.message);
        }
        return res.json({
            success: true,
            message: `Order successfully auto-assigned to rider ${result.rider.name}!`,
            order: updatedOrder,
            rider: result.rider
        });
    } catch (err) {
        console.error('Auto-assignment failed:', err);
        return res.status(getErrorStatus(err)).json({
            success: false,
            message: err.message || 'Auto-assignment failed.'
        });
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
        const existingOrder = await Order.findOne({
            _id: req.params.id,
            $or: [{ userId: req.user.sub }, { customerId: req.user.sub }]
        }).select('_id tenantId').lean();
        if (!existingOrder) return res.status(404).json({ message: 'Order not found.' });
        if (req.file) {
            uploadedPrescriptionUrl = await savePrescription(req.file, req.user.sub, existingOrder.tenantId || null);
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

const handleCustomerCancelOrder = async (req, res) => {
    try {
        if (req.user?.app_metadata?.role === 'admin') {
            return res.status(403).json({ message: 'Customers can only cancel their own orders.' });
        }
        const order = await dataStore.cancelOrder(
            req.params.id,
            req.user.user_metadata?.name || req.user.email || 'Customer',
            req.user.sub
        );
        res.json({ message: 'Order cancelled and reserved stock released.', order });
    } catch (err) {
        console.error('Order cancellation failed:', err);
        res.status(getErrorStatus(err)).json({ message: err.message || 'Failed to cancel order.' });
    }
};

router.put('/:id/cancel', authenticateUser, handleCustomerCancelOrder);
router.post('/:id/cancel', authenticateUser, handleCustomerCancelOrder);

// Order State Machine Transition
router.post('/admin/transition', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { orderId, newStatus, cashCollectionStatus } = req.body;
        if (isTenantOrderStaff(req)) {
            const tenantId = getActorTenantId(req);
            if (!tenantId) return res.status(403).json({ message: 'An active tenant context is required.' });
            const scopedOrder = await Order.findOne({ _id: orderId, tenantId: String(tenantId) }).select('_id').lean();
            if (!scopedOrder) return res.status(404).json({ message: 'Order not found.' });
        }
        let { riderInfo } = req.body;
        if (!orderId || !newStatus) {
            return res.status(400).json({ message: "orderId and newStatus are required." });
        }
        const targetOrder = await Order.findById(orderId).select('_id tenantId').lean();
        if (!targetOrder || (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || ''))) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        if (newStatus === 'Dispatched') {
            deliveryContainer.refreshDataLayer();
            const currentOrder = await deliveryContainer.orderRepository.findById(orderId, targetOrder.tenantId);
            riderInfo = await resolveDispatchRider(
                riderInfo?.riderId || currentOrder?.rider?.riderId,
                orderId,
                targetOrder.tenantId
            );
        }

        const actor = req.user.user_metadata?.name || req.user.email || 'Pharmacist Admin';
        let updatedOrder = await dataStore.transitionOrderStatus(orderId, newStatus, actor, riderInfo, cashCollectionStatus);
        let assignmentMessage = '';
        let notificationEvent = newStatus === 'Ready to Dispatch' ? 'Ready to Dispatch' : null;
        let notificationMobile = updatedOrder.rider?.riderMobile;

        if (newStatus === 'Approved' || newStatus === 'Ready to Dispatch') {
            try {
                deliveryContainer.refreshDataLayer();
                const assignResult = await deliveryContainer.assignmentEngine.assignOrder(orderId, { tenantId: targetOrder.tenantId });
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

        // Trigger notification according to lifecycle
        if (newStatus === 'Dispatched') notificationEvent = 'Dispatched';
        else if (newStatus === 'Delivered') notificationEvent = 'Delivered';

        if (notificationEvent) {
            try {
                await sendCustomWhatsAppAlert(updatedOrder, notificationEvent, notificationMobile);
            } catch (notificationError) {
                console.warn(`[WhatsApp] ${notificationEvent} notification failed:`, notificationError.message);
            }
        }

        res.json({
            message: `Order transitioned to ${newStatus}.${assignmentMessage}`,
            order: updatedOrder,
            deliveryRewards: updatedOrder.deliveryRewards || null
        });
    } catch (err) {
        console.error("Transition error:", err);
        res.status(getErrorStatus(err)).json({
            code: err.code || 'ORDER_TRANSITION_FAILED',
            message: err.message || "State transition failed",
            retryable: ['PRESCRIPTION_PROCESSING_STUCK', 'PRESCRIPTION_SERVICE_UNAVAILABLE'].includes(err.code)
        });
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
        const tenantId = isTenantOrderStaff(req)
            ? getActorTenantId(req)
            : (getActorTenantId(req) || req.body.tenantId || null);
        if (!tenantId) return res.status(400).json({ message: 'Select a pharmacy tenant before planning a route.' });
        if (!riderId) return res.status(400).json({ message: 'Select an onboarded rider before planning a route.' });
        const rider = await deliveryContainer.riderRepository.findById(riderId, tenantId);
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
            Number(startLng) || 77.5946,
            tenantId
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
        const targetOrders = await Order.find({ _id: { $in: orderIds } }).select('_id tenantId').lean();
        if (targetOrders.length !== new Set(orderIds.map(String)).size) return res.status(404).json({ message: 'One or more orders were not found.' });
        const targetTenantIds = [...new Set(targetOrders.map(order => String(order.tenantId || '')))];
        if (targetTenantIds.length !== 1 || !targetTenantIds[0]) return res.status(400).json({ message: 'A dispatch batch must contain orders from exactly one pharmacy tenant.' });
        const targetTenantId = targetTenantIds[0];
        if (isTenantOrderStaff(req) && targetTenantId !== String(getActorTenantId(req) || '')) return res.status(404).json({ message: 'Orders not found.' });
        const riderInfo = await resolveDispatchRider(riderId, null, targetTenantId);

        const actor = req.user.user_metadata?.name || req.user.email || 'Logistics Admin';

        const dispatchedOrders = [];
        const dispatchErrors = [];
        for (const id of orderIds) {
            try {
                const updated = await dataStore.transitionOrderStatus(id, 'Dispatched', actor, riderInfo);
                dispatchedOrders.push(updated);
                try {
                    await sendCustomWhatsAppAlert(updated, 'Dispatched', riderInfo.riderMobile);
                } catch (notificationError) {
                    console.warn(`[WhatsApp] Batch dispatch notification failed for order ${id}:`, notificationError.message);
                }
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
        const targetOrder = await Order.findById(orderId).select('_id tenantId').lean();
        if (!targetOrder || (isTenantOrderStaff(req) && String(targetOrder.tenantId || '') !== String(getActorTenantId(req) || ''))) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        if (targetStatus === 'Dispatched') {
            deliveryContainer.refreshDataLayer();
            const currentOrder = await deliveryContainer.orderRepository.findById(orderId, targetOrder.tenantId);
            riderInfo = await resolveDispatchRider(currentOrder?.rider?.riderId, orderId, targetOrder.tenantId);
        }
        let order = await dataStore.transitionOrderStatus(orderId, targetStatus, actor, riderInfo);
        let assignmentMessage = '';
        let notificationEvent = step === 'ready' ? 'Ready to Dispatch' : null;
        if (step === 'ready') {
            try {
                deliveryContainer.refreshDataLayer();
                const result = await deliveryContainer.assignmentEngine.assignOrder(orderId, { tenantId: targetOrder.tenantId });
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
            try {
                await sendCustomWhatsAppAlert(order, notificationEvent, order.rider?.riderMobile);
            } catch (notificationError) {
                console.warn(`[WhatsApp] ${notificationEvent} notification failed for order ${orderId}:`, notificationError.message);
            }
        }

        res.json({ message: `Transaction status shifted safely.${assignmentMessage}`, order });
    } catch (err) {
        console.error("Order status update failed:", err);
        res.status(400).json({ message: err.message || "Failed to update order status." });
    }
});

// Manual / Server WhatsApp Notification Trigger (GET and POST supported)
const handleNotifyWhatsApp = async (req, res) => {
    try {
        const { id } = req.params;
        const target = req.query.target || req.body?.target || 'all';
        const customType = req.query.type || req.body?.type || null;

        const order = await dataStore.getOrderById(id);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        let eventType = customType;
        if (!eventType) {
            if (order.orderStatus === 'Dispatched') {
                eventType = 'Dispatched';
            } else if (order.orderStatus === 'Delivered') {
                eventType = 'Delivered';
            } else if (order.rider?.riderId || order.orderStatus === 'Ready to Dispatch') {
                eventType = 'Assigned';
            } else {
                eventType = order.orderStatus || 'Placed';
            }
        }

        const riderMobile = order.rider?.riderMobile || null;
        const customerMobile = order.customerMobile || order.addressDetails?.mobile || null;
        let sentCount = 0;
        const dispatchedTo = [];

        if ((target === 'all' || target === 'rider') && riderMobile) {
            try {
                await sendCustomWhatsAppAlert(order, eventType, riderMobile);
                sentCount++;
                dispatchedTo.push({ recipient: 'rider', mobile: riderMobile });
            } catch (err) {
                console.warn(`[WhatsApp Notify] Failed to notify rider for order ${id}:`, err.message);
            }
        }

        if ((target === 'all' || target === 'customer') && customerMobile) {
            try {
                await sendCustomWhatsAppAlert(order, eventType, customerMobile);
                sentCount++;
                dispatchedTo.push({ recipient: 'customer', mobile: customerMobile });
            } catch (err) {
                console.warn(`[WhatsApp Notify] Failed to notify customer for order ${id}:`, err.message);
            }
        }

        dataStore.logAudit(
            req.user?.sub || 'Admin',
            'WHATSAPP_NOTIFICATION_TRIGGERED',
            'ORDER',
            id,
            { target, eventType, dispatchedTo }
        );

        return res.json({
            success: true,
            message: sentCount > 0
                ? `WhatsApp notification dispatched for Order #${(order._id || id).toString().slice(-6).toUpperCase()} to ${dispatchedTo.map(d => d.recipient).join(' and ')}.`
                : `WhatsApp alert queued/recorded for Order #${(order._id || id).toString().slice(-6).toUpperCase()}.`,
            orderId: id,
            eventType,
            dispatchedTo
        });
    } catch (err) {
        console.error('WhatsApp notify error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Failed to dispatch WhatsApp notification' });
    }
};

router.get('/:id/notify-whatsapp', authenticateUser, isAdmin, handleNotifyWhatsApp);
router.post('/:id/notify-whatsapp', authenticateUser, isAdmin, handleNotifyWhatsApp);

// Admin All Orders
router.get('/admin/all', authenticateUser, isAdmin, async (req, res) => {
    try {
        if (isTenantOrderStaff(req)) {
            const tenantId = getActorTenantId(req);
            if (!tenantId) return res.status(403).json({ message: 'An active tenant context is required.' });
            const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
            const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
            if (req.query.fulfillmentSnapshot === 'true') {
                const snapshot = await dataStore.getFulfillmentSnapshot(page, limit, String(tenantId));
                for (const key of ['orders', 'items', 'recentOrders', 'latestOrders']) if (Array.isArray(snapshot?.[key])) await sanitizeTenantRiderReferences(snapshot[key]);
                return res.json(snapshot);
            }
            if (req.query.search !== undefined) {
                const { type, value } = classifyOrderSearch(req.query.search);
                const result = await dataStore.searchOrders({ type, value, page, limit, tenantId: String(tenantId) });
                await sanitizeTenantRiderReferences(result.items || []);
                return res.json({ ...paginationResult(result.items, result.total, result.page || 1, limit), searchType: type });
            }
            const filter = { tenantId: String(tenantId) };
            if (req.query.status) filter.$or = [
                { orderStatus: req.query.status },
                { status: String(req.query.status).toLowerCase() }
            ];
            if (req.query.status === 'Delivered' || req.query.status === 'Cancelled') {
                const result = req.query.status === 'Delivered'
                    ? await dataStore.getDeliveredOrdersPage(page, limit, {
                        tenantId: String(tenantId),
                        startDate: req.query.startDate,
                        endDate: req.query.endDate
                    })
                    : await dataStore.getCancelledOrdersPage(page, limit, { tenantId: String(tenantId) });
                await sanitizeTenantRiderReferences(result.items || []);
                return res.json(paginationResult(result.items, result.total, result.page || page, limit));
            }
            const orders = await Order.find(filter).sort({ createdAt: -1, _id: -1 }).lean().catch(() => []);
            await sanitizeTenantRiderReferences(orders);
            return res.json(orders);
        }
        if (isPlatformOrderAdmin(req) && req.query.tenantId) {
            const tenantId = String(req.query.tenantId);
            const selectedTenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean().catch(() => null);
            if (!selectedTenant && getIsConnected()) return res.status(404).json({ message: 'Active pharmacy tenant not found.' });
            const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
            const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
            if (req.query.fulfillmentSnapshot === 'true') {
                return res.json(await dataStore.getFulfillmentSnapshot(page, limit, tenantId));
            }
            if (req.query.search !== undefined) {
                const { type, value } = classifyOrderSearch(req.query.search);
                const result = await dataStore.searchOrders({ type, value, page, limit, tenantId });
                return res.json({ ...paginationResult(result.items, result.total, result.page || 1, limit), searchType: type });
            }
            const filter = { tenantId };
            if (req.query.status) filter.$or = [
                { orderStatus: req.query.status },
                { status: String(req.query.status).toLowerCase() }
            ];
            if (req.query.status === 'Delivered' || req.query.status === 'Cancelled') {
                const result = req.query.status === 'Delivered'
                    ? await dataStore.getDeliveredOrdersPage(page, limit, {
                        tenantId,
                        startDate: req.query.startDate,
                        endDate: req.query.endDate
                    })
                    : await dataStore.getCancelledOrdersPage(page, limit, { tenantId });
                await sanitizeTenantRiderReferences(result.items || []);
                return res.json(paginationResult(result.items, result.total, result.page || page, limit));
            }
            const [items, total] = await Promise.all([
                Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
                Order.countDocuments(filter)
            ]);
            await sanitizeTenantRiderReferences(items);
            return res.json(paginationResult(items, total, page, limit));
        }
        if (req.query.search !== undefined) {
            const { type, value } = classifyOrderSearch(req.query.search);
            const parsedPage = Number.parseInt(req.query.page, 10);
            const parsedLimit = Number.parseInt(req.query.limit, 10);
            const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
            const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10;
            const result = await dataStore.searchOrders({ type, value, page: requestedPage, limit });
            const page = result.page || 1;
            return res.json({ ...paginationResult(result.items, result.total, page, limit), searchType: type });
        }
        if (req.query.status !== undefined) {
            const parsedPage = Number.parseInt(req.query.page, 10);
            const parsedLimit = Number.parseInt(req.query.limit, 10);
            const requestedPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
            const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10;
            let result;
            if (req.query.status === 'Delivered') result = await dataStore.getDeliveredOrdersPage(requestedPage, limit, { startDate: req.query.startDate, endDate: req.query.endDate });
            else if (req.query.status === 'Cancelled') result = await dataStore.getCancelledOrdersPage(requestedPage, limit);
            else return res.status(400).json({ message: 'Only Delivered and Cancelled orders support pagination on this endpoint.' });
            return res.json(paginationResult(result.items, result.total, result.page || 1, limit));
        }
        if (req.query.fulfillmentSnapshot === 'true') {
            const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
            const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
            return res.json(await dataStore.getFulfillmentSnapshot(page, limit));
        }
        return res.json(await dataStore.getAllOrders());
    } catch (err) {
        const statusCode = getErrorStatus(err);
        console.error('[OrderRoutes] Admin order retrieval failed:', err);
        return res.status(statusCode).json({
            code: err.code || (statusCode === 503 ? 'ORDER_STORAGE_UNAVAILABLE' : 'ORDER_RETRIEVAL_FAILED'),
            message: statusCode === 503
                ? 'Order history is temporarily unavailable. Please try again.'
                : statusCode === 400
                    ? err.message
                    : 'Failed to retrieve orders.'
        });
    }
});

// Keep the static /mine route before /:id so Express does not
// treat "mine" as an order ID and return INVALID_ORDER_ID.
router.get('/mine', authenticateUser, async (req, res) => {
    try {
        const orders = await dataStore.getUserOrders(req.user.sub);
        await sanitizeTenantRiderReferences(orders);
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
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 3));
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
            .sort({ createdAt: -1, _id: -1 })
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .lean();
        await sanitizeTenantRiderReferences(orders);
        res.status(200).json({
            orders,
            items: orders,
            pagination: {
                page: currentPage,
                pageSize: limit,
                limit,
                total,
                totalPages,
                hasNextPage: currentPage < totalPages,
                hasPreviousPage: currentPage > 1
            }
        });
    } catch (err) {
        console.error('Order history retrieval failed:', err);
        res.status(500).json({ message: 'Failed to retrieve order history.' });
    }
});


// Customer/admin order detail used by the tracking UI.
router.get('/:id', authenticateUser, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Order tracking is temporarily unavailable.' });
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order ID.' });
        const order = await Order.findById(req.params.id).lean();
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (!canTenantAccessOrder(req, order)) {
            return res.status(404).json({ message: 'Order not found.' });
        }
        if (!isPlatformOrderAdmin(req)) await sanitizeTenantRiderReferences(order);
        return res.json({ success: true, order });
    } catch (error) {
        console.error('Order tracking retrieval failed:', error);
        return res.status(500).json({ message: 'Could not load the latest order tracking status.' });
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


// Retrieve delivery OTP from cache service (held for 1 day) or generate/sync with database
router.get('/:id/reveal-otp', authenticateUser, async (req, res) => {
    try {
        if (!getIsConnected() || !mongoose.isValidObjectId(req.params.id)) {
            return res.status(503).json({ message: 'Service unavailable.' });
        }
        const order = await Order.findById(req.params.id);
        if (!order || !canTenantAccessOrder(req, order)) return res.status(404).json({ message: 'Order not found.' });
        let cachedOtp = await cacheService.get(`delivery_otp:${req.params.id}`);
        if (cachedOtp) {
            return res.json({ otp: cachedOtp, source: 'cache_service_1_day' });
        }

        cachedOtp = String(randomInt(0, 10000)).padStart(4, '0');
        order.deliveryVerification = {
            otpHash: scryptSync(cachedOtp, String(order._id), 32).toString('hex'),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            attempts: 0,
            verifiedAt: null
        };
        await order.save();
        await cacheService.set(`delivery_otp:${req.params.id}`, cachedOtp, 86400);

        return res.json({ otp: cachedOtp, source: 'generated_and_cached' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Could not reveal OTP.' });
    }
});

// Regenerate and resend delivery OTP (cached for 1 day, notifies customer)
router.post('/:id/resend-otp', authenticateUser, async (req, res) => {
    try {
        if (!getIsConnected() || !mongoose.isValidObjectId(req.params.id)) {
            return res.status(503).json({ message: 'Service unavailable.' });
        }
        const order = await Order.findById(req.params.id);
        if (!order || !canTenantAccessOrder(req, order)) return res.status(404).json({ message: 'Order not found.' });
        if (order.orderStatus !== 'Dispatched') {
            return res.status(409).json({ message: 'Order must be out for delivery to resend OTP.' });
        }

        const newOtp = String(randomInt(0, 10000)).padStart(4, '0');
        order.deliveryVerification = {
            otpHash: scryptSync(newOtp, String(order._id), 32).toString('hex'),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            attempts: 0,
            verifiedAt: null
        };
        await order.save();
        await cacheService.set(`delivery_otp:${order._id}`, newOtp, 86400);

        try {
            await sendCustomWhatsAppAlert(order, 'Dispatched');
        } catch (whatsappErr) {
            console.warn('[WhatsApp] Resend OTP alert failed:', whatsappErr?.message);
        }

        return res.json({ success: true, message: 'New delivery OTP generated, cached for 24h, and sent to customer.', otp: newOtp });
    } catch (error) {
        console.error('Resend OTP failed:', error);
        return res.status(500).json({ message: error.message || 'Could not resend OTP.' });
    }
});

router.post('/:id/verify-delivery', authenticateUser, async (req, res) => {
    const role = String(req.user?.app_metadata?.role || req.user?.role || req.context?.role || 'customer').toUpperCase();
    const staffRoles = new Set(['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'ORDER_MANAGER', 'PHARMACY']);
    const platformStaff = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    try {
        if (!getIsConnected() || !mongoose.isValidObjectId(req.params.id)) {
            return res.status(503).json({ message: 'Delivery verification is temporarily unavailable.' });
        }
        const order = await Order.findById(req.params.id).select('+deliveryVerification.otpHash +deliveryVerification.expiresAt +deliveryVerification.attempts +deliveryVerification.verifiedAt');
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (order.orderStatus !== 'Dispatched') {
            return res.status(409).json({ message: 'The order must be out for delivery before it can be completed.' });
        }

        if (!order.tenantId) return res.status(404).json({ message: 'Order not found.' });
        const rider = await Rider.findOne({
            supabaseId: req.user.sub,
            tenantId: String(order.tenantId),
            enabled: true
        }).lean();
        if (rider) {
            if (!isAssignedRiderForOrder(rider, order)) {
                return res.status(403).json({ message: 'This delivery is not assigned to your rider account.' });
            }
        } else {
            if (!staffRoles.has(role)) return res.status(403).json({ message: 'Only the assigned rider can verify delivery.' });
            if (!platformStaff && !isSameTenant(getActorTenantId(req), order.tenantId)) {
                return res.status(404).json({ message: 'Order not found.' });
            }
            const requestedRiderId = String(req.body?.riderId || order.rider?.riderId || order.riderId || '');
            const assignedRiderId = String(order.rider?.riderId || order.riderId || '');
            if (!requestedRiderId || requestedRiderId !== assignedRiderId) {
                return res.status(403).json({ message: 'Only the rider assigned to this order can verify delivery.' });
            }
            const assignedRider = await Rider.findOne({
                _id: requestedRiderId,
                tenantId: String(order.tenantId),
                enabled: true
            }).select('_id').lean();
            if (!isAssignedRiderForOrder(assignedRider, order)) return res.status(404).json({ message: 'Assigned rider not found for this pharmacy.' });
        }

        const code = String(req.body?.otp || '').trim();
        if (!/^\d{4}$/.test(code)) return res.status(400).json({ message: 'Enter the 4-digit code shared by the customer.' });
        const verification = order.deliveryVerification || {};
        if (!verification.otpHash || !verification.expiresAt || new Date(verification.expiresAt) <= new Date()) {
            return res.status(409).json({ message: 'The delivery code is missing or expired. Ask the pharmacy to resend the out-for-delivery notification.' });
        }
        if (Number(verification.attempts || 0) >= 5) {
            return res.status(429).json({ message: 'Too many incorrect attempts. Ask the pharmacy to reissue the delivery code.' });
        }
        const candidateHash = scryptSync(code, String(order._id), 32).toString('hex');
        const storedHash = String(verification.otpHash);
        const matches = candidateHash.length === storedHash.length
            && timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'));
        if (!matches) {
            await Order.updateOne({
                _id: order._id,
                orderStatus: 'Dispatched',
                'deliveryVerification.verifiedAt': null,
                'deliveryVerification.attempts': { $lt: 5 }
            }, { $inc: { 'deliveryVerification.attempts': 1 } });
            return res.status(400).json({ message: 'The delivery code is incorrect. Check the customer’s code and try again.' });
        }

        const claimed = await Order.findOneAndUpdate({
            _id: order._id,
            orderStatus: 'Dispatched',
            'deliveryVerification.otpHash': storedHash,
            'deliveryVerification.verifiedAt': null,
            'deliveryVerification.expiresAt': { $gt: new Date() },
            'deliveryVerification.attempts': { $lt: 5 }
        }, { $set: { 'deliveryVerification.verifiedAt': new Date() } }, { new: true });
        if (!claimed) return res.status(409).json({ message: 'This delivery code has already been used, expired, or the order has changed.' });

        let deliveredOrder;
        try {
            deliveredOrder = await dataStore.transitionOrderStatus(
                String(order._id),
                'Delivered',
                rider?.name || req.user.user_metadata?.name || req.user.email || 'Assigned Rider',
                null,
                null,
                true
            );
        } catch (error) {
            await Order.updateOne({ _id: order._id, orderStatus: 'Dispatched' }, { $set: { 'deliveryVerification.verifiedAt': null } });
            throw error;
        }
        try {
            await sendCustomWhatsAppAlert(deliveredOrder, 'Delivered');
        } catch (notificationError) {
            console.warn('[WhatsApp] Delivery-complete notification failed:', notificationError?.message);
        }
        return res.json({ success: true, message: 'Delivery verified and order completed.', order: deliveredOrder });
    } catch (error) {
        console.error('Proof of delivery verification failed:', error);
        return res.status(getErrorStatus(error)).json({ message: error.message || 'Could not verify delivery.' });
    }
});


// Notification logs audit
router.get('/notifications/logs', authenticateUser, isAdmin, async (req, res) => {
    try {
        const logs = await getNotificationLog();
        if (isTenantOrderStaff(req)) {
            const tenantId = getActorTenantId(req);
            if (!tenantId) return res.status(403).json({ message: 'An active tenant context is required.' });
            const tenantOrders = await Order.find({ tenantId: String(tenantId) }).select('_id orderNumber').lean();
            const allowedOrderReferences = new Set(tenantOrders.flatMap(order => [String(order._id), String(order.orderNumber || '')]));
            return res.json(logs.filter(log => allowedOrderReferences.has(String(log.orderId || ''))));
        }
        return res.json(logs);
    } catch (err) {
        console.error("Notification log retrieval failed:", err);
        res.status(500).json({ message: "Failed to retrieve notification logs" });
    }
});

export default router;
