import express from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import { authenticateUser, requirePermission } from '../middleware/auth.js';
import { getPrescription, savePrescription } from '../config/prescriptionStorage.js';
import { getIsConnected } from '../config/db.js';
import MedicineRequest from '../models/MedicineRequest.js';
import Medicine from '../models/Medicine.js';
import UserAddress from '../models/UserAddress.js';
import Tenant from '../models/Tenant.js';
import FulfillmentCase from '../models/FulfillmentCase.js';
import { validateWaitWindow } from '../services/intelligentFulfillment/fulfillmentPlanner.js';
import { customerService } from '../services/customer-service/CustomerService.js';
import prescriptionClient from '../services/prescription-service-client/PrescriptionClient.js';

const router = express.Router();

const requireDatabase = (res) => {
    if (getIsConnected()) return true;
    res.status(503).json({ message: 'Medicine requests require an active database connection.' });
    return false;
};

const isStaff = (user) => [
    'ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'PHARMACY',
    'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'PHARMACY_STAFF',
    'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN'
].includes(String(user?.app_metadata?.role || user?.role || '').toUpperCase());

const requireCustomer = (req, res, next) => {
    const role = req.user?.app_metadata?.role || req.user?.role || 'customer';
    if (!['customer', 'authenticated'].includes(role)) {
        return res.status(403).json({ message: 'This action is available to customers only.' });
    }
    return next();
};

const authorizeCustomerAction = (req, res, next) => {
    if (req.baseUrl.startsWith('/api/admin/')) {
        return res.status(403).json({ message: 'Customer decisions must use the customer medicine request API.' });
    }
    return requireCustomer(req, res, next);
};

const authorizeRequestList = (req, res, next) => {
    if (req.baseUrl.startsWith('/api/admin/')) {
        return requirePermission('medicine_requests.read')(req, res, next);
    }
    return requireCustomer(req, res, next);
};

const getRequestActorTenantId = req => req.user?.tenantId || req.user?.app_metadata?.tenantId || null;
const isPlatformRequestAdmin = req => ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN']
    .includes(String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase());

const authorizeRequestDetails = async (req, res, next) => {
    if (req.params.fileId) return next(); // Attachment ownership is checked against file metadata in its handler.
    if (req.baseUrl.startsWith('/api/admin/') && !isStaff(req.user)) {
        return res.status(403).json({ message: 'You are not authorized to view this medicine request.' });
    }
    if (!requireDatabase(res)) return;
    try {
        const request = await dataStore.getMedicineRequestById(req.params.id, req.user);
        if (!request) return res.status(404).json({ message: 'Medicine request not found.' });
        req.authorizedMedicineRequest = request;
        return next();
    } catch (error) {
        return res.status(error.statusCode || 503).json({ message: 'Unable to authorize medicine request access.' });
    }
};

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 2 },
    fileFilter: (req, file, callback) => {
        if (!allowedMimeTypes.has(file.mimetype)) {
            return callback(new Error('Uploaded file must be a PDF, JPEG, PNG, or WebP file.'));
        }
        callback(null, true);
    }
});

const validateFileSignature = (file) => {
    if (!file || !file.buffer) return true;

    const buffer = file.buffer;
    const len = buffer.length;

    // Helper functions for common buffer checks
    const matchString = (start, end, str) => len >= end && buffer.subarray(start, end).toString('utf8') === str;
    const matchBytes = (bytes) => len >= bytes.length && bytes.every((b, i) => buffer[i] === b);

    // 1. PDF
    if (file.mimetype === 'application/pdf') {
        return matchString(0, 5, '%PDF-');
    }

    // 2. JPEG (Safe check requires only the first 2 marker bytes)
    if (file.mimetype === 'image/jpeg') {
        return matchBytes([0xFF, 0xD8]);
    }

    // 3. PNG
    if (file.mimetype === 'image/png') {
        return matchBytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    // 4. WEBP
    if (file.mimetype === 'image/webp') {
        return matchString(0, 4, 'RIFF') && matchString(8, 12, 'WEBP');
    }

    // 5. GIF
    if (file.mimetype === 'image/gif') {
        return matchString(0, 3, 'GIF');
    }

    // 6. BMP
    if (file.mimetype === 'image/bmp' || file.mimetype === 'image/x-ms-bmp') {
        return matchString(0, 2, 'BM');
    }

    // 7. TIFF
    if (file.mimetype === 'image/tiff') {
        return matchBytes([0x49, 0x49, 0x2A, 0x00]) || matchBytes([0x4D, 0x4D, 0x00, 0x2A]);
    }

    // 8. HEIC / HEIF (Robust check for container major/compatible brands)
    if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') {
        if (!matchString(4, 8, 'ftyp')) return false;
        const brand = len >= 12 ? buffer.subarray(8, 12).toString('utf8') : '';
        return ['heic', 'heix', 'hevc', 'heim', 'mif1', 'msf1'].includes(brand);
    }

    // 9. AVIF (Robust check for container major/compatible brands)
    if (file.mimetype === 'image/avif') {
        if (!matchString(4, 8, 'ftyp')) return false;
        const brand = len >= 12 ? buffer.subarray(8, 12).toString('utf8') : '';
        return ['avif', 'avis'].includes(brand);
    }

    // 10. SVG (Safely inspect XML tags while stripping non-printable padding)
    if (file.mimetype === 'image/svg+xml') {
        const sample = buffer.subarray(0, Math.min(len, 512)).toString('utf8').trim().toLowerCase();
        return sample.includes('<svg') || sample.includes('<?xml');
    }

    return false;
};


const normalizePrescriptionVerification = prescription => ({
    status: prescription?.status === 'APPROVED'
        ? 'MATCHED'
        : prescription?.status === 'REVIEW_REQUIRED'
            ? 'REVIEW_REQUIRED'
            : prescription?.status === 'REJECTED'
                ? 'REJECTED'
                : prescription?.status === 'INACTIVE'
                    ? 'INACTIVE'
                    : 'PROCESSING',
    prescriptionId: prescription?.prescriptionId || null,
    patientPuid: prescription?.patientPuid || null,
    overallConfidence: Number(prescription?.quality?.overallConfidence || prescription?.extraction?.overallConfidence || 0),
    lastCheckedAt: new Date(),
    source: 'PYTHON_PRESCRIPTION_SERVICE',
    medicines: (prescription?.medicines || prescription?.extraction?.medicines || []).map((medicine, index) => ({
        rawName: medicine.rawName || '',
        normalizedName: medicine.normalizedName || medicine.rawName || '',
        strength: medicine.strength || null,
        dose: medicine.dose || null,
        frequency: medicine.frequency || null,
        duration: medicine.duration || null,
        course: medicine.course || null,
        instructions: medicine.instructions || null,
        confidence: Number(medicine.confidence || 0),
        validationStatus: medicine.medicineValidation?.status || 'EXTRACTED',
        productId: medicine.medicineValidation?.productId || null,
        prescriptionMedicineIndex: index
    })),
    issues: prescription?.status === 'REVIEW_REQUIRED'
        ? ['Prescription requires pharmacist verification.']
        : prescription?.status === 'REJECTED'
            ? ['Prescription was rejected.']
            : []
});

const syncPrescriptionVerification = async request => {
    if (!request?.prescriptionId || !prescriptionClient.isConfigured()) return request;
    const currentStatus = request.prescriptionVerification?.status;
    if (currentStatus && currentStatus !== 'PROCESSING') return request;
    try {
        const prescription = await prescriptionClient.get(request.prescriptionId, {
            userId: request.customerId,
            tenantId: request.tenantId || null,
            branchId: request.branchId || null,
            role: 'customer'
        });
        const verification = normalizePrescriptionVerification(prescription);
        const updated = await MedicineRequest.findOneAndUpdate(
            { _id: request._id },
            { $set: { prescriptionVerification: verification } },
            { new: true }
        ).lean();
        return updated || { ...request, prescriptionVerification: verification };
    } catch {
        return request;
    }
};

const handleAttachments = (req, res, next) => {
    upload.fields([
        { name: 'prescription', maxCount: 1 },
        { name: 'productImage', maxCount: 1 }
    ])(req, res, (err) => {
        if (err) return res.status(400).json({ message: err.message || 'File upload error.' });
        const presFile = req.files?.prescription?.[0];
        const imgFile = req.files?.productImage?.[0];
        if (presFile && !validateFileSignature(presFile)) {
            return res.status(400).json({ message: 'The uploaded prescription file format is invalid.' });
        }
        if (imgFile && !validateFileSignature(imgFile)) {
            return res.status(400).json({ message: 'The uploaded product image file format is invalid.' });
        }
        next();
    });
};

// -------------------------------------------------------------
// CUSTOMER APIS
// -------------------------------------------------------------

// Replace/re-upload the prescription for an existing customer medicine request.
router.put('/:id/prescription', authenticateUser, requirePermission('medicine_requests.create'), authorizeCustomerAction, handleAttachments, async (req, res) => {
    try {
        if (!requireDatabase(res)) return;
        const customerId = req.user.sub;
        const request = await MedicineRequest.findOne({ _id: req.params.id, customerId });
        if (!request) return res.status(404).json({ message: 'Medicine request not found.' });

        if (['CONVERTED_TO_ORDER', 'CUSTOMER_APPROVED', 'CANCELLED', 'CUSTOMER_REJECTED', 'PHARMACY_REJECTED'].includes(request.status)) {
            return res.status(409).json({ message: 'This medicine request cannot accept a prescription update in its current state.' });
        }
        const presFile = req.files?.prescription?.[0];
        if (!presFile) return res.status(400).json({ message: 'A replacement prescription file is required.' });
        const oldUrl = request.prescriptionUrl || null;
        const newUrl = await savePrescription(presFile, customerId, request.tenantId || null);
        try {
            let prescriptionId = request.prescriptionId;
            let result = null;
            if (!prescriptionId) {
                result = await prescriptionClient.upload({
                    buffer: presFile.buffer,
                    filename: presFile.originalname,
                    contentType: presFile.mimetype,
                    idempotencyKey: req.get('idempotency-key') || `medicine-request-upload:${request._id}:${Date.now()}`,
                    userId: customerId,
                    tenantId: request.tenantId || req.user.tenantId || null,
                    branchId: request.branchId || req.user.branchId || null,
                    role: req.user.app_metadata?.role || req.user.role || 'customer',
                    patientPuid: request.patientPuid || null
                });
                prescriptionId = result?.prescriptionId || null;
            } else {
                result = await prescriptionClient.replace(prescriptionId, {
                    buffer: presFile.buffer,
                    filename: presFile.originalname,
                    contentType: presFile.mimetype,
                    idempotencyKey: req.get('idempotency-key') || `medicine-request-replace:${request._id}:${Date.now()}`,
                    userId: customerId,
                    tenantId: request.tenantId || req.user.tenantId || null,
                    branchId: request.branchId || req.user.branchId || null,
                    role: req.user.app_metadata?.role || req.user.role || 'customer'
                });
            }
            const verification = {
                status: 'PROCESSING',
                prescriptionId,
                patientPuid: request.patientPuid || null,
                overallConfidence: 0,
                lastCheckedAt: new Date(),
                source: 'PYTHON_PRESCRIPTION_SERVICE',
                medicines: [],
                issues: [],
                documentVersion: result?.documentVersion || null
            };
            const updated = await MedicineRequest.findOneAndUpdate(
                { _id: request._id, customerId },
                {
                    $set: { prescriptionUrl: newUrl, prescriptionId, prescriptionVerification: verification },
                    $push: {
                        auditTrail: {
                            action: 'PRESCRIPTION_UPDATED',
                            actorId: customerId,
                            role: 'Customer',
                            timestamp: new Date(),
                            notes: 'Customer uploaded or replaced the prescription document; previous extraction is no longer authoritative.'
                        }
                    }
                },
                { new: true }
            ).lean();
            if (oldUrl && oldUrl !== newUrl) {
                try { await (await import('../config/prescriptionStorage.js')).removePrescription(oldUrl); } catch {}
            }
            return res.json({
                success: true,
                request: updated,
                prescription: result,
                message: 'Prescription updated. It has been queued for reprocessing and re-verification.'
            });
        } catch (error) {
            try { await (await import('../config/prescriptionStorage.js')).removePrescription(newUrl); } catch {}
            return res.status(error.statusCode || 503).json({
                code: error.code || 'PRESCRIPTION_UPDATE_FAILED',
                message: error.message || 'Prescription update could not be processed.'
            });
        }
    } catch (error) {
        console.error('Prescription replacement failed:', error);
        return res.status(500).json({ message: 'Unable to update prescription.' });
    }
});

// Create a new medicine request
router.post('/', authenticateUser, requirePermission('medicine_requests.create'), authorizeCustomerAction, handleAttachments, async (req, res) => {
    try {
        if (!requireDatabase(res)) return;

        const customerId = req.user.sub;
        const customer = await customerService.ensureCustomerForUser(customerId, {
            name: req.user.user_metadata?.name,
            email: req.user.email,
            phone: req.user.user_metadata?.mobile
        });
        const patientPuid = String(req.body.patientPuid || customer.selfPuid || '').trim() || null;
        if (patientPuid) {
            try {
                await customerService.assertUserCanAccessPuid(customerId, patientPuid);
            } catch (error) {
                return res.status(error.statusCode || 403).json({
                    code: 'PUID_ACCESS_DENIED',
                    message: 'You are not authorized to use this patient profile for the prescription.'
                });
            }
        }
        const addressId = String(req.body.addressId || '').trim();
        if (!addressId) {
            return res.status(400).json({
                code: 'ADDRESS_REQUIRED',
                message: 'Select a saved delivery address before submitting this medicine request.'
            });
        }
        let selectedAddress = null;
        if (mongoose.isValidObjectId(addressId)) {
            selectedAddress = await UserAddress.findOne({
                _id: addressId,
                userId: customerId
            }).lean();
        }
        if (!selectedAddress) {
            selectedAddress = await dataStore.getUserAddress(customerId, addressId);
        }
        if (!selectedAddress) {
            return res.status(404).json({ message: 'The selected saved address was not found.' });
        }

        let requestedItems = req.body.requestedItems;
        if (typeof requestedItems === 'string') {
            try {
                requestedItems = JSON.parse(requestedItems);
            } catch {
                requestedItems = [];
            }
        }
        if (!requestedItems || !requestedItems.length) {
            // Single-item shorthand support from form fields
            requestedItems = [
                {
                    requestedName: req.body.requestedName || req.body.medicineName || '',
                    strength: req.body.strength || '',
                    dosageForm: req.body.dosageForm || '',
                    manufacturer: req.body.manufacturer || '',
                    quantity: Number(req.body.quantity) || 1,
                    originalAvailabilityStatus: req.body.originalAvailabilityStatus || 'NOT_IN_CATALOG'
                }
            ];
        }

        let prescriptionUrl = req.body.prescriptionUrl || null;
        let prescriptionId = req.body.prescriptionId || null;
        let productImageUrl = req.body.productImageUrl || null;
        let prescriptionVerification = null;
        let savedPrescriptionUrl = null;

        const selectedTenantId = String(req.body.tenantId || req.body.selectedTenantId || '').trim();
        if (!selectedTenantId) {
            return res.status(400).json({ message: 'Select a pharmacy before submitting a medicine procurement request.' });
        }
        const selectedTenant = await Tenant.findOne({ _id: selectedTenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!selectedTenant) return res.status(404).json({ message: 'Selected pharmacy is unavailable.' });

        const presFile = req.files?.prescription?.[0];
        if (presFile) {
            savedPrescriptionUrl = await savePrescription(presFile, req.user.sub, selectedTenantId);
            prescriptionUrl = savedPrescriptionUrl;

            if (!prescriptionClient.isConfigured()) {
                prescriptionVerification = {
                    status: 'PROCESSING',
                    prescriptionId: null,
                    patientPuid,
                    overallConfidence: 0,
                    lastCheckedAt: new Date(),
                    source: 'PRESCRIPTION_SERVICE_PENDING',
                    medicines: [],
                    issues: ['Prescription processing service is temporarily unavailable; pharmacy review is required before dispensing.']
                };
            } else try {
                const result = await prescriptionClient.upload({
                    buffer: presFile.buffer,
                    filename: presFile.originalname,
                    contentType: presFile.mimetype,
                    idempotencyKey: req.get('idempotency-key') || `medicine-request:${customerId}:${Date.now()}`,
                    userId: customerId,
                    tenantId: selectedTenantId,
                    branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
                    role: req.user.app_metadata?.role || req.user.role || 'customer',
                    patientPuid
                });
                prescriptionId = result?.prescriptionId || null;
                prescriptionVerification = {
                    status: 'PROCESSING',
                    prescriptionId,
                    patientPuid,
                    overallConfidence: 0,
                    lastCheckedAt: new Date(),
                    source: 'PYTHON_PRESCRIPTION_SERVICE',
                    medicines: [],
                    issues: []
                };
            } catch (error) {
                prescriptionVerification = {
                    status: 'PROCESSING',
                    prescriptionId: null,
                    patientPuid,
                    overallConfidence: 0,
                    lastCheckedAt: new Date(),
                    source: 'PYTHON_PRESCRIPTION_SERVICE',
                    medicines: [],
                    issues: [error.message || 'Prescription processing could not be started; pharmacy review is required.']
                };
            }
        } else if (prescriptionId) {
            prescriptionVerification = {
                status: 'PROCESSING',
                prescriptionId,
                patientPuid,
                overallConfidence: 0,
                lastCheckedAt: new Date(),
                source: 'PYTHON_PRESCRIPTION_SERVICE',
                medicines: [],
                issues: []
            };
        }

        const imgFile = req.files?.productImage?.[0];
        if (imgFile) {
            productImageUrl = await savePrescription(imgFile, req.user.sub, selectedTenantId);
        }

        const addressDetails = {
            addressId: String(selectedAddress._id),
            label: selectedAddress.label,
            fullName: selectedAddress.fullName,
            mobile: selectedAddress.mobile,
            addressLine1: selectedAddress.addressLine1,
            addressLine2: selectedAddress.addressLine2,
            city: selectedAddress.city,
            state: selectedAddress.state,
            postalCode: selectedAddress.postalCode || selectedAddress.pincode || '',
            pincode: selectedAddress.pincode,
            landmark: selectedAddress.landmark,
            country: selectedAddress.country,
            coordinates: selectedAddress.coordinates
        };
        const deliveryAddress = selectedAddress.addressLine
            || [selectedAddress.addressLine1, selectedAddress.addressLine2, selectedAddress.city, selectedAddress.state, selectedAddress.pincode]
                .filter(Boolean)
                .join(', ');

        const requestDoc = await dataStore.createMedicineRequest({
            tenantId: selectedTenantId,
            branchId: req.user.branchId || req.user.app_metadata?.branchId || null,
            urgencyLevel: req.body.urgencyLevel || 'Normal',
            requestedItems,
            prescriptionUrl,
            prescriptionId,
            patientPuid,
            prescriptionVerification,
            productImageUrl,
            customerNote: req.body.customerNote || '',
            addressId: String(selectedAddress._id),
            deliveryAddress,
            addressDetails,
            coordinates: selectedAddress.coordinates,
            preferredDeliveryPreference: req.body.preferredDeliveryPreference || 'Flexible',
            customerPhone: req.body.customerPhone || ''
        }, req.user);

        res.status(201).json({
            message: `Medicine request #${requestDoc.requestNumber} registered successfully. Our pharmacy team will review it.`,
            request: requestDoc
        });
    } catch (err) {
        console.error('Failed to create medicine request:', err);
        const isDuplicate = err.code === 11000;
        res.status(err.statusCode || (isDuplicate ? 409 : 400)).json({
            message: isDuplicate
                ? 'A duplicate request number was detected. Please retry your request.'
                : err.message || 'Failed to submit medicine request.'
        });
    }
});

// Active pipeline excludes requests that have already produced a proposal.
router.get('/active', authenticateUser, authorizeRequestList, async (req, res) => {
    if (!getIsConnected()) {
        return res.status(503).json({ message: 'Medicine requests are temporarily unavailable.' });
    }

    const staff = isStaff(req.user);

    try {
        const query = { status: { $nin: ['converted', 'CONVERTED_TO_ORDER'] } };
        if (!staff) {
            query.customerId = req.user.sub;
        } else if (!isPlatformRequestAdmin(req)) {
            const tenantId = getRequestActorTenantId(req);
            if (!tenantId) return res.status(403).json({ message: 'An active pharmacy tenant is required.' });
            query.tenantId = String(tenantId);
            if (req.query.customerId) query.customerId = String(req.query.customerId);
        } else if (req.query.tenantId) {
            query.tenantId = String(req.query.tenantId);
        }
        const requests = await MedicineRequest.find(query).sort({ createdAt: -1 }).lean();
        res.json({ requests });
    } catch (error) {
        console.error('Active medicine request retrieval failed:', error);
        res.status(500).json({ message: 'Failed to fetch active medicine requests.' });
    }
});

// Admin request queue. This explicit route is kept separate from the customer GET / route
// so /api/medicine-requests/admin/all can never be interpreted as a customer request.
const getAdminMedicineRequests = async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(50, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 8));
        const result = await dataStore.getMedicineRequestsPage(req.query, req.user, page, pageSize);
        let requests = result.requests || [];
        if (prescriptionClient.isConfigured()) {
            requests = await Promise.all(requests.map(request => syncPrescriptionVerification(request)));
        }
        return res.json({ requests, items: requests, pagination: result.pagination });
    } catch (err) {
        console.error('Failed to fetch admin medicine requests:', err);
        return res.status(err.statusCode || 500).json({ message: err.message || 'Failed to fetch medicine requests.' });
    }
};

// Legacy/admin UI contract. Must remain before /:id.
router.get('/admin/all', authenticateUser, requirePermission('medicine_requests.read'), getAdminMedicineRequests);

// Get customer's medicine requests
router.get('/', authenticateUser, authorizeRequestList, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 3));
        const staff = isStaff(req.user);
        const platformAdmin = isPlatformRequestAdmin(req);
        const actorTenantId = getRequestActorTenantId(req);
        const expiryScope = platformAdmin
            ? {}
            : staff
                ? (actorTenantId ? { tenantId: String(actorTenantId) } : { tenantId: '__NO_TENANT_ACCESS__' })
                : { customerId: req.user.sub };
        await MedicineRequest.updateMany(
            { ...expiryScope, status: 'converted', pharmacyProposal: { $ne: null } },
            { $set: { status: 'PROPOSAL_SENT' } }
        );
        await MedicineRequest.updateMany(
            { ...expiryScope, status: 'PROPOSAL_SENT', expiresAt: { $lt: new Date() } },
            { $set: { status: 'EXPIRED' } }
        );
        if (req.baseUrl.startsWith('/api/admin/') || staff) {
            return getAdminMedicineRequests(req, res);
        }
        const query = { customerId: req.user.sub };

        const statusGroup = String(req.query.statusGroup || '').toUpperCase();
        if (statusGroup === 'ACTIVE') {
            query.status = { $in: ['REQUESTED', 'UNDER_REVIEW', 'PROPOSAL_SENT', 'WAITING_FOR_STOCK', 'READY_FOR_CONFIRMATION'] };
        } else if (statusGroup === 'COMPLETED') {
            query.status = { $in: ['CUSTOMER_APPROVED', 'CONVERTED_TO_ORDER'] };
        } else if (req.query.status && req.query.status !== 'ALL') {
            query.status = String(req.query.status);
        }
        if (req.query.search && String(req.query.search).trim()) {
            const search = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [
                { requestNumber: { $regex: search, $options: 'i' } },
                { customerName: { $regex: search, $options: 'i' } },
                { 'requestedItems.requestedName': { $regex: search, $options: 'i' } }
            ];
        }

        const total = await MedicineRequest.countDocuments(query);
        const totalPages = Math.ceil(total / limit);
        const currentPage = Math.min(page, Math.max(totalPages, 1));
        let requests = await MedicineRequest.find(query)
            .sort({ createdAt: -1, _id: -1 })
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .lean();
        if (prescriptionClient.isConfigured()) {
            requests = await Promise.all(requests.map(request => syncPrescriptionVerification(request)));
        }
        res.json({
            requests,
            items: requests,
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
        console.error('Failed to fetch medicine requests:', err);
        res.status(500).json({ message: 'Failed to fetch your medicine requests.' });
    }
});

// Admin/pharmacy pending-work count; count is always queried from persisted request statuses.
router.get('/pending-count', authenticateUser, requirePermission('medicine_requests.pending_count'), async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const tenantId = isPlatformRequestAdmin(req) ? (req.query.tenantId || null) : getRequestActorTenantId(req);
        if (!isPlatformRequestAdmin(req) && !tenantId) return res.status(403).json({ message: 'An active pharmacy tenant is required.' });
        const count = await dataStore.getPendingMedicineRequestCount(tenantId);
        res.json({ count });
    } catch (error) {
        console.error('Pending medicine request count retrieval failed:', error);
        res.status(500).json({ message: 'Failed to fetch pending medicine request count.' });
    }
});

// View attachment securely
router.get('/attachments/:fileId', authenticateUser, authorizeRequestDetails, async (req, res) => {
    try {
        const file = await getPrescription(req.params.fileId);
        if (!file) return res.status(404).json({ message: 'Attachment file not found.' });

        const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
        const platformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        const actorTenantId = getRequestActorTenantId(req);
        const tenantStaff = ['PHARMACY', 'TENANT_ADMIN', 'TENANT_OWNER', 'PHARMACIST', 'PHARMACY_STAFF', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'BRANCH_ADMIN'].includes(role);
        const ownerAccess = String(file.ownerId || '') === String(req.user.sub);
        const tenantAccess = tenantStaff && actorTenantId && file.tenantId
            && String(actorTenantId) === String(file.tenantId);
        if (!ownerAccess && !tenantAccess && !platformAdmin) {
            return res.status(404).json({ message: 'Attachment file not found.' });
        }

        res.set('Content-Type', file.contentType || 'application/octet-stream');
        res.set('Content-Disposition', 'inline; filename="attachment"');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'private, no-store');

        if (file.stream) {
            file.stream.on('error', error => {
                console.error('Attachment streaming failed:', error);
                if (!res.headersSent) res.status(500).end();
            });
            file.stream.pipe(res);
        } else {
            res.send(file.buffer);
        }
    } catch (err) {
        console.error('Attachment retrieval failed:', err);
        res.status(500).json({ message: 'Failed to retrieve attachment.' });
    }
});

// Get specific request details
router.get('/:id', authenticateUser, authorizeRequestDetails, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const request = await dataStore.getMedicineRequestById(req.params.id, req.user);
        if (!request) return res.status(404).json({ message: 'Medicine request not found.' });
        res.json({ request });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Failed to fetch medicine request.' });
    }
});

// Return the real Python Prescription Service extraction/verification result.
router.get('/:id/scan-prescription', authenticateUser, authorizeRequestDetails, async (req, res) => {
    try {
        const request = await dataStore.getMedicineRequestById(req.params.id, req.user);
        if (!request) return res.status(404).json({ success: false, message: 'Medicine request not found.' });
        if (!request.prescriptionId) {
            return res.status(409).json({
                success: false,
                code: 'PRESCRIPTION_NOT_LINKED',
                message: 'This request does not have a linked Prescription Service record.'
            });
        }
        if (!prescriptionClient.isConfigured()) {
            return res.status(503).json({ success: false, code: 'PRESCRIPTION_SERVICE_UNAVAILABLE', message: 'Prescription processing service is unavailable.' });
        }

        const prescription = await prescriptionClient.get(request.prescriptionId, {
            userId: req.user.sub,
            tenantId: req.user.tenantId || req.user.app_metadata?.tenantId || request.tenantId || null,
            branchId: req.user.branchId || req.user.app_metadata?.branchId || request.branchId || null,
            role: req.user.app_metadata?.role || req.user.role || 'admin',
            isAdmin: isStaff(req.user)
        });
        const verification = normalizePrescriptionVerification(prescription);
        const updated = await MedicineRequest.findByIdAndUpdate(
            request._id,
            { $set: { prescriptionVerification: verification } },
            { new: true }
        ).lean();

        return res.json({
            success: true,
            prescriptionId: request.prescriptionId,
            verified: prescription.status === 'APPROVED',
            status: prescription.status,
            confidence: verification.overallConfidence,
            scannedMedicines: verification.medicines,
            issues: verification.issues,
            rawText: prescription.extraction?.rawText || null,
            ocrModel: prescription.extraction?.ocrVersion || null,
            verifiedAt: verification.lastCheckedAt,
            request: updated || request
        });
    } catch (error) {
        console.error('Prescription scan failed:', error);
        res.status(error.statusCode || 503).json({
            success: false,
            message: error.message || 'Failed to read prescription processing result.'
        });
    }
});




router.get('/:id/fulfillment-options', authenticateUser, requirePermission('medicine_requests.read'), authorizeRequestDetails, async (req, res) => {
    if (!requireDatabase(res)) return;
    if (!isStaff(req.user)) return res.status(403).json({ message: 'Pharmacy staff access is required.' });
    try {
        const request = req.authorizedMedicineRequest;
        if (!request?.tenantId) return res.status(409).json({ message: 'This request is not linked to an active pharmacy.' });
        const results = [];
        for (let index = 0; index < (request.requestedItems || []).length; index += 1) {
            const item = request.requestedItems[index];
            if (!item.composition || !item.strength || !item.dosageForm) {
                results.push({ itemIndex: index, requestedName: item.requestedName, options: [], reason: 'Composition, strength and dosage form are required before safe alternatives can be suggested.' });
                continue;
            }
            const query = {
                tenantId: String(request.tenantId),
                isActive: { $ne: false },
                composition: String(item.composition).trim(),
                strength: String(item.strength).trim(),
                expiryDate: { $gt: new Date() }
            };
            if (item.dosageForm) query.dosageForm = String(item.dosageForm).trim();
            if (request.branchId) query.branchId = String(request.branchId);
            const products = await Medicine.find(query).limit(25).select('_id name brand manufacturer composition strength dosageForm form price discountPercentage stockQuantity stock quantity reservedQuantity requiresPrescription isPrescriptionRequired expiryDate').lean();
            const options = products.map(product => {
                const physical = Number(product.stockQuantity ?? product.stock ?? product.quantity ?? 0);
                const availableQuantity = Math.max(0, physical - Number(product.reservedQuantity || 0));
                const discountPercentage = Math.min(100, Math.max(0, Number(product.discountPercentage || 0)));
                const unitPrice = Number(product.price || 0);
                return {
                    productId: String(product._id), medicineName: product.name,
                    manufacturer: product.manufacturer || product.brand || '',
                    composition: product.composition || '', strength: product.strength || '',
                    dosageForm: product.dosageForm || product.form || '',
                    unitPrice, discountPercentage,
                    discountedUnitPrice: Math.round(unitPrice * (1 - discountPercentage / 100) * 100) / 100,
                    availableQuantity,
                    requiresPrescription: Boolean(product.requiresPrescription ?? product.isPrescriptionRequired),
                    requiresPharmacistApproval: Boolean(item.source === 'PRESCRIPTION_EXTRACTED' || request.prescriptionId || request.prescriptionUrl),
                    customerConsentRequired: true
                };
            }).filter(option => option.availableQuantity > 0 && option.unitPrice >= 0)
              .sort((a, b) => a.discountedUnitPrice - b.discountedUnitPrice);
            results.push({ itemIndex: index, requestedName: item.requestedName, requestedQuantity: item.quantity, options });
        }
        return res.json({ requestId: String(request._id), tenantId: String(request.tenantId), items: results });
    } catch (error) {
        return res.status(error.statusCode || 503).json({ message: 'Unable to calculate safe fulfilment options.' });
    }
});

router.post('/:id/waitlist', authenticateUser, requirePermission('medicine_requests.decide'), authorizeCustomerAction, authorizeRequestDetails, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const request = req.authorizedMedicineRequest;
        if (!request?.tenantId) return res.status(409).json({ message: 'Select a pharmacy before waiting for stock.' });
        if (['CONVERTED_TO_ORDER', 'CUSTOMER_APPROVED', 'CANCELLED', 'CUSTOMER_REJECTED', 'PHARMACY_REJECTED', 'EXPIRED'].includes(request.status)) {
            return res.status(409).json({ message: 'This medicine request cannot be placed on a stock waitlist in its current state.' });
        }
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (!idempotencyKey || idempotencyKey.length > 128) return res.status(400).json({ message: 'A valid Idempotency-Key header is required.' });
        const { waitDays, waitUntil } = validateWaitWindow(req.body?.waitDays);
        const existing = await FulfillmentCase.findOne({ customerId: String(req.user.sub), tenantId: String(request.tenantId), idempotencyKey }).lean();
        if (existing) return res.json({ case: existing, alreadyCreated: true });
        const requestedItems = Array.isArray(request.requestedItems) ? request.requestedItems : [];
        if (!requestedItems.length) return res.status(400).json({ message: 'No medicine line items are available to wait for.' });
        const lines = requestedItems.map((item, index) => ({
            productId: mongoose.isValidObjectId(item.productId) ? String(item.productId) : (mongoose.isValidObjectId(item.medicineId) ? String(item.medicineId) : null),
            name: item.requestedName || item.name || `Requested medicine ${index + 1}`,
            composition: item.composition || '',
            strength: item.strength || '',
            dosageForm: item.dosageForm || '',
            manufacturer: item.manufacturer || '',
            requestedQuantity: Number(item.quantity || 1),
            allocatedQuantity: 0,
            waitingQuantity: Number(item.quantity || 1),
            customerDecision: 'ACCEPTED_ORIGINAL',
            prescriptionRequired: Boolean(request.prescriptionId || request.prescriptionUrl)
        }));
        const caseNumber = 'FUL-' + randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
        const created = await FulfillmentCase.create({
            caseNumber, customerId: String(request.customerId), tenantId: String(request.tenantId),
            branchId: request.branchId || null, sourceType: 'MEDICINE_REQUEST', sourceId: String(request._id),
            addressId: request.addressId || null, deliveryAddress: request.deliveryAddress || '',
            addressDetails: request.addressDetails || {}, coordinates: request.coordinates || null,
            prescriptionUrl: request.prescriptionUrl || null, prescriptionId: request.prescriptionId || null,
            patientPuid: request.patientPuid || null,
            status: 'WAITING_FOR_STOCK', lines, waitDays, waitUntil, idempotencyKey,
            auditTrail: [{ action: 'MEDICINE_REQUEST_WAITLISTED', actorId: String(req.user.sub), at: new Date(), waitDays, waitUntil }]
        });
        const updatedRequest = await MedicineRequest.findOneAndUpdate(
            { _id: request._id, customerId: String(req.user.sub), status: request.status },
            { $set: { status: 'WAITING_FOR_STOCK', fulfillmentCaseId: String(created._id), waitDays, waitUntil },
              $push: { auditTrail: { action: 'WAITING_FOR_STOCK', actorId: String(req.user.sub), role: 'Customer', timestamp: new Date(), notes: `Customer requested a ${waitDays}-day stock wait window.` } } },
            { new: true }
        ).lean();
        if (!updatedRequest) {
            await FulfillmentCase.deleteOne({ _id: created._id, customerId: String(req.user.sub) });
            return res.status(409).json({ message: 'Medicine request changed. Refresh and try again.' });
        }
        return res.status(201).json({ case: created.toObject(), request: updatedRequest, message: 'We will monitor availability for the selected wait period.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to create medicine stock waitlist.' });
    }
});

// Customer approves proposal -> triggers idempotent order conversion
router.post('/:id/approve', authenticateUser, requirePermission('medicine_requests.decide'), authorizeCustomerAction, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const result = await dataStore.approveMedicineProposalAndConvertToOrder(
            req.params.id,
            req.body.approvalNote || '',
            req.user,
            req.body.selectedProductId || null
        );
        res.json(result);
    } catch (err) {
        console.error('Proposal approval failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to approve proposal.' });
    }
});

// Customer rejects proposal
router.post('/:id/reject', authenticateUser, requirePermission('medicine_requests.decide'), authorizeCustomerAction, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const request = await dataStore.rejectMedicineProposalByCustomer(
            req.params.id,
            req.body.reason || '',
            req.user
        );
        res.json({ message: 'Proposal declined.', request });
    } catch (err) {
        console.error('Proposal rejection failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to reject proposal.' });
    }
});

// Customer cancels medicine request
router.post('/:id/cancel', authenticateUser, requirePermission('medicine_requests.decide'), authorizeCustomerAction, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const request = await dataStore.cancelMedicineRequestByCustomer(
            req.params.id,
            req.body.reason || '',
            req.user
        );
        res.json({ message: 'Medicine request cancelled successfully.', request });
    } catch (err) {
        console.error('Medicine request cancellation failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to cancel medicine request.' });
    }
});

router.delete('/:id', authenticateUser, requirePermission('medicine_requests.decide'), authorizeCustomerAction, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const request = await dataStore.cancelMedicineRequestByCustomer(
            req.params.id,
            req.body.reason || req.query.reason || '',
            req.user
        );
        res.json({ message: 'Medicine request cancelled successfully.', request });
    } catch (err) {
        console.error('Medicine request cancellation failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to cancel medicine request.' });
    }
});

// -------------------------------------------------------------
// PHARMACY / ADMIN APIS
// -------------------------------------------------------------

// Metrics
router.get('/metrics/overview', authenticateUser, requirePermission('medicine_requests.read'), async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const tenantId = isPlatformRequestAdmin(req) ? null : getRequestActorTenantId(req);
        if (!isPlatformRequestAdmin(req) && !tenantId) return res.status(403).json({ message: 'An active pharmacy tenant is required.' });
        const metrics = await dataStore.getMedicineRequestMetrics(req.user);
        res.json(metrics);
    } catch (err) {
        console.error('Failed to get medicine request metrics:', err);
        res.status(500).json({ message: 'Failed to compute request metrics.' });
    }
});

// Review request
router.put('/:id/review', authenticateUser, requirePermission('medicine_requests.manage'), authorizeRequestDetails, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const actorName = req.user.user_metadata?.name || req.user.email || 'Pharmacist';
        const actorRole = req.user.app_metadata?.role || req.user.role || 'Pharmacist';
        const request = await dataStore.reviewMedicineRequest(req.params.id, actorName, actorRole);
        res.json({ message: 'Medicine request is now under review.', request });
    } catch (err) {
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to update review status.' });
    }
});

// Create/Send proposal
router.post('/:id/proposal', authenticateUser, requirePermission('medicine_requests.proposal'), authorizeRequestDetails, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const actorName = req.user.user_metadata?.name || req.user.email || 'Pharmacist';
        const actorRole = req.user.app_metadata?.role || req.user.role || 'Pharmacist';
        const request = await dataStore.createOrUpdateProposal(req.params.id, req.body, actorName, actorRole);
        res.json({ message: 'Proposal dispatched to customer.', request });
    } catch (err) {
        console.error('Proposal creation failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to create proposal.' });
    }
});

// Update proposal
router.put('/:id/proposal', authenticateUser, requirePermission('medicine_requests.proposal'), authorizeRequestDetails, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const actorName = req.user.user_metadata?.name || req.user.email || 'Pharmacist';
        const actorRole = req.user.app_metadata?.role || req.user.role || 'Pharmacist';
        const request = await dataStore.createOrUpdateProposal(req.params.id, req.body, actorName, actorRole);
        res.json({ message: 'Proposal updated and re-sent to customer.', request });
    } catch (err) {
        console.error('Proposal update failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to update proposal.' });
    }
});

// Pharmacy rejects request
router.post('/:id/reject-request', authenticateUser, requirePermission('medicine_requests.manage'), authorizeRequestDetails, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const actorName = req.user.user_metadata?.name || req.user.email || 'Pharmacist';
        const actorRole = req.user.app_metadata?.role || req.user.role || 'Pharmacist';
        const request = await dataStore.rejectMedicineRequestByPharmacy(
            req.params.id,
            req.body.reason || '',
            actorName,
            actorRole
        );
        res.json({ message: 'Medicine request declined by pharmacy.', request });
    } catch (err) {
        console.error('Pharmacy rejection failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to reject request.' });
    }
});

export default router;
