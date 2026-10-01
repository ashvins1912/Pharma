import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import { authenticateUser, isPharmacyOrAdmin } from '../middleware/auth.js';
import { getPrescription, savePrescription } from '../config/prescriptionStorage.js';
import { getIsConnected } from '../config/db.js';
import MedicineRequest from '../models/MedicineRequest.js';
import UserAddress from '../models/UserAddress.js';

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
    if (role !== 'customer') {
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

// Create a new medicine request
router.post('/', authenticateUser, authorizeCustomerAction, handleAttachments, async (req, res) => {
    try {
        if (!requireDatabase(res)) return;

        const customerId = req.user.sub;
        const addressId = String(req.body.addressId || '').trim();
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
        let productImageUrl = req.body.productImageUrl || null;

        const presFile = req.files?.prescription?.[0];
        if (presFile) {
            prescriptionUrl = await savePrescription(presFile, req.user.sub);
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
        res.status(err.statusCode || 400).json({ message: err.message || 'Failed to submit medicine request.' });
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
        const limit = 5;
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
        const requests = await MedicineRequest.find(query)
            .sort({ createdAt: -1 })
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .lean();
        res.json({
            requests,
            pagination: { page: currentPage, limit, total, totalPages }
        });
    } catch (err) {
        console.error('Failed to fetch medicine requests:', err);
        res.status(500).json({ message: 'Failed to fetch your medicine requests.' });
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
