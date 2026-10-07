import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import { authenticateUser, isPharmacyOrAdmin } from '../middleware/auth.js';
import { getPrescription, savePrescription } from '../config/prescriptionStorage.js';
import { getIsConnected } from '../config/db.js';
import MedicineRequest from '../models/MedicineRequest.js';
import UserAddress from '../models/UserAddress.js';
import prescriptionClient from '../services/prescription-service-client/PrescriptionClient.js';
import { customerService } from '../services/customer-service/CustomerService.js';

const router = express.Router();

const requireDatabase = (res) => {
    if (getIsConnected()) return true;
    res.status(503).json({ message: 'Medicine requests require an active database connection.' });
    return false;
};

const isStaff = (user) => ['admin', 'pharmacy'].includes(
    user?.app_metadata?.role || user?.role
);

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
        return isPharmacyOrAdmin(req, res, next);
    }
    return requireCustomer(req, res, next);
};

const authorizeRequestDetails = (req, res, next) => {
    if (req.baseUrl.startsWith('/api/admin/')) {
        return isPharmacyOrAdmin(req, res, next);
    }
    return next();
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
    overallConfidence: Number(prescription?.quality?.overallConfidence || 0),
    lastCheckedAt: new Date(),
    source: 'PYTHON_PRESCRIPTION_SERVICE',
    medicines: (prescription?.medicines || []).map((medicine, index) => ({
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
    if (currentStatus && !['PROCESSING'].includes(currentStatus)) return request;
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
    } catch (error) {
        // Do not turn a read/poll failure into a false verification result.
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
router.put('/:id/prescription', authenticateUser, authorizeCustomerAction, handleAttachments, async (req, res) => {
    try {
        if (!requireDatabase(res)) return;

        const customerId = req.user.sub;
        const customer = await customerService.ensureCustomerForUser(customerId, {
            name: req.user.user_metadata?.name,
            email: req.user.email,
            phone: req.user.user_metadata?.mobile
        });
        const request = await MedicineRequest.findOne({ _id: req.params.id, customerId });
        if (!request) return res.status(404).json({ message: 'Medicine request not found.' });

        if (['CONVERTED_TO_ORDER', 'CUSTOMER_APPROVED', 'CANCELLED', 'CUSTOMER_REJECTED', 'PHARMACY_REJECTED'].includes(request.status)) {
            return res.status(409).json({ message: 'This medicine request cannot accept a prescription update in its current state.' });
        }

        const presFile = req.files?.prescription?.[0];
        if (!presFile) return res.status(400).json({ message: 'A replacement prescription file is required.' });
        try {
            await customerService.assertUserCanAccessPuid(customerId, request.patientPuid || customer.selfPuid);
        } catch {
            return res.status(403).json({ code: 'PUID_ACCESS_DENIED', message: 'Prescription patient access is not authorized.' });
        }

        if (!request.prescriptionId) {
            return res.status(409).json({ code: 'PRESCRIPTION_NOT_LINKED', message: 'This medicine request is not linked to the Python Prescription Service.' });
        }
        if (!prescriptionClient.isConfigured()) {
            return res.status(503).json({ code: 'PRESCRIPTION_SERVICE_UNAVAILABLE', message: 'Prescription processing is temporarily unavailable.' });
        }

        const oldUrl = request.prescriptionUrl || null;
        const newUrl = await savePrescription(presFile, customerId);
        try {
            const idempotencyKey = req.get('idempotency-key') || ('medicine-request-replace:' + String(request._id) + ':' + Date.now());
            const result = await prescriptionClient.replace(request.prescriptionId, {
                buffer: presFile.buffer,
                filename: presFile.originalname,
                contentType: presFile.mimetype,
                idempotencyKey,
                userId: customerId,
                tenantId: request.tenantId || req.user.app_metadata?.tenantId || req.user.tenantId || null,
                branchId: request.branchId || req.user.app_metadata?.branchId || req.user.branchId || null,
                role: req.user.app_metadata?.role || req.user.role || 'customer'
            });

            const verification = {
                status: 'PROCESSING',
                prescriptionId: request.prescriptionId,
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
                    $set: { prescriptionUrl: newUrl, prescriptionVerification: verification },
                    $push: {
                        auditTrail: {
                            action: 'PRESCRIPTION_UPDATED',
                            actorId: customerId,
                            role: 'Customer',
                            timestamp: new Date(),
                            notes: 'Customer replaced the prescription document; previous extraction is no longer authoritative.'
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
router.post('/', authenticateUser, authorizeCustomerAction, handleAttachments, async (req, res) => {
    try {
        if (!requireDatabase(res)) return;

        const customerId = req.user.sub;
        const customer = await customerService.ensureCustomerForUser(customerId, {
            name: req.user.user_metadata?.name,
            email: req.user.email,
            phone: req.user.user_metadata?.mobile
        });
        let patientPuid = String(req.body.patientPuid || customer.selfPuid || '').trim() || null;
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
        if (!mongoose.isValidObjectId(addressId)) {
            return res.status(400).json({
                code: 'ADDRESS_REQUIRED',
                message: 'Select a saved delivery address before submitting this medicine request.'
            });
        }
        const selectedAddress = await UserAddress.findOne({
            _id: addressId,
            userId: customerId
        }).lean();
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

        const presFile = req.files?.prescription?.[0];
        if (presFile) {
            if (!prescriptionClient.isConfigured()) {
                return res.status(503).json({
                    code: 'PRESCRIPTION_SERVICE_UNAVAILABLE',
                    message: 'Prescription processing is temporarily unavailable. Please try again.'
                });
            }
            savedPrescriptionUrl = await savePrescription(presFile, req.user.sub);
            prescriptionUrl = savedPrescriptionUrl;
            try {
                const result = await prescriptionClient.upload({
                    buffer: presFile.buffer,
                    filename: presFile.originalname,
                    contentType: presFile.mimetype,
                    idempotencyKey: req.get('idempotency-key') || `medicine-request:${req.user.sub}:${Date.now()}`,
                    userId: req.user.sub,
                    tenantId: req.user.app_metadata?.tenantId || req.user.tenantId || null,
                    branchId: req.user.app_metadata?.branchId || req.user.branchId || null,
                    role: req.user.app_metadata?.role || req.user.role || 'customer',
                    patientPuid
                });
                prescriptionId = result?.prescriptionId || null;
                prescriptionVerification = {
                    status: 'PROCESSING',
                    prescriptionId,
                    patientPuid: req.body.patientPuid || null,
                    overallConfidence: 0,
                    lastCheckedAt: new Date(),
                    source: 'PYTHON_PRESCRIPTION_SERVICE',
                    medicines: [],
                    issues: []
                };
            } catch (error) {
                if (savedPrescriptionUrl) {
                    try { await (await import('../config/prescriptionStorage.js')).removePrescription(savedPrescriptionUrl); } catch {}
                }
                return res.status(error.statusCode || 503).json({
                    code: error.code || 'PRESCRIPTION_SERVICE_UNAVAILABLE',
                    message: error.message || 'Prescription processing could not be started.'
                });
            }
        } else if (prescriptionId) {
            prescriptionVerification = {
                status: 'PROCESSING',
                prescriptionId,
                patientPuid: req.body.patientPuid || null,
                overallConfidence: 0,
                lastCheckedAt: new Date(),
                source: 'PYTHON_PRESCRIPTION_SERVICE',
                medicines: [],
                issues: []
            };
        }

        const imgFile = req.files?.productImage?.[0];
        if (imgFile) {
            productImageUrl = await savePrescription(imgFile, req.user.sub);
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
        if (!staff) query.customerId = req.user.sub;
        else if (req.query.customerId) query.customerId = String(req.query.customerId);
        const requests = await MedicineRequest.find(query).sort({ createdAt: -1 }).lean();
        res.json({ requests });
    } catch (error) {
        console.error('Active medicine request retrieval failed:', error);
        res.status(500).json({ message: 'Failed to fetch active medicine requests.' });
    }
});

// Get customer's medicine requests
router.get('/', authenticateUser, authorizeRequestList, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 3));
        await MedicineRequest.updateMany(
            { status: 'converted', pharmacyProposal: { $ne: null } },
            { $set: { status: 'PROPOSAL_SENT' } }
        );
        await MedicineRequest.updateMany(
            { status: 'PROPOSAL_SENT', expiresAt: { $lt: new Date() } },
            { $set: { status: 'EXPIRED' } }
        );
        if (req.baseUrl.startsWith('/api/admin/')) {
            const requests = await dataStore.getMedicineRequests(req.query, req.user);
            return res.json({ requests });
        }
        const query = { customerId: req.user.sub };

        const statusGroup = String(req.query.statusGroup || '').toUpperCase();
        if (statusGroup === 'ACTIVE') {
            query.status = { $in: ['REQUESTED', 'UNDER_REVIEW', 'PROPOSAL_SENT'] };
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
router.get('/pending-count', authenticateUser, isPharmacyOrAdmin, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const count = await dataStore.getPendingMedicineRequestCount();
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

        const role = req.user?.app_metadata?.role || req.user?.role;
        if (file.ownerId !== req.user.sub && role !== 'admin' && role !== 'pharmacy') {
            return res.status(403).json({ message: 'You are not authorized to view this attachment.' });
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

// Read the real Python Prescription Service result. No fabricated OCR output.
router.get('/:id/scan-prescription', authenticateUser, authorizeRequestDetails, async (req, res) => {
    try {
        const request = await dataStore.getMedicineRequestById(req.params.id, req.user);
        if (!request) return res.status(404).json({ message: 'Medicine request not found.' });
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

        const role = req.user?.app_metadata?.role || req.user?.role || 'admin';
        const prescription = await prescriptionClient.get(request.prescriptionId, {
            userId: req.user.sub,
            tenantId: req.user.app_metadata?.tenantId || req.user.tenantId || request.tenantId || null,
            branchId: req.user.app_metadata?.branchId || req.user.branchId || request.branchId || null,
            role,
            isAdmin: true
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
            rawText: null,
            ocrModel: prescription.quality?.ocrModelVersion || null,
            verifiedAt: verification.lastCheckedAt,
            request: updated || request
        });
    } catch (err) {
        console.error('Prescription scan failed:', err);
        res.status(err.statusCode || 503).json({ success: false, message: err.message || 'Failed to read prescription processing result.' });
    }
});

// Customer approves proposal -> triggers idempotent order conversion
router.post('/:id/approve', authenticateUser, authorizeCustomerAction, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const result = await dataStore.approveMedicineProposalAndConvertToOrder(
            req.params.id,
            req.body.approvalNote || '',
            req.user
        );
        res.json(result);
    } catch (err) {
        console.error('Proposal approval failed:', err);
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to approve proposal.' });
    }
});

// Customer rejects proposal
router.post('/:id/reject', authenticateUser, authorizeCustomerAction, async (req, res) => {
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
router.post('/:id/cancel', authenticateUser, authorizeCustomerAction, async (req, res) => {
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

router.delete('/:id', authenticateUser, authorizeCustomerAction, async (req, res) => {
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
router.get('/metrics/overview', authenticateUser, isPharmacyOrAdmin, async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const metrics = await dataStore.getMedicineRequestMetrics();
        res.json(metrics);
    } catch (err) {
        console.error('Failed to get medicine request metrics:', err);
        res.status(500).json({ message: 'Failed to compute request metrics.' });
    }
});

// Review request
router.put('/:id/review', authenticateUser, isPharmacyOrAdmin, async (req, res) => {
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
router.post('/:id/proposal', authenticateUser, isPharmacyOrAdmin, async (req, res) => {
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
router.put('/:id/proposal', authenticateUser, isPharmacyOrAdmin, async (req, res) => {
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
router.post('/:id/reject-request', authenticateUser, isPharmacyOrAdmin, async (req, res) => {
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
