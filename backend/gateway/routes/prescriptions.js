/**
 * API Gateway Prescription Service Routes (/api/v1/prescriptions/*)
 * Enforces authentication, forwards trusted internal Service JWT,
 * and maintains the exact response envelope contracts.
 */
import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { prescriptionService } from '../../services/prescription-service/PrescriptionService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { DomainError } from '../../shared/errors/DomainErrors.js';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

const router = express.Router();

const SERVICE_SECRET = process.env.SERVICE_AUTH_SECRET || 'ashvin-pharmacy-demo-admin-jwt-secret-key-32chars!';
const SERVICE_ISSUER = 'ashvin-pharmacy';
const SERVICE_AUDIENCE = 'prescription-service';

function createInternalServiceToken(req) {
    const claims = {
        sub: req.user?.sub || req.user?.userId || req.context?.userId || 'anonymous-user',
        tenantId: req.context?.tenantId || null,
        branchId: req.context?.branchId || req.headers['x-branch-id'] || null,
        role: req.user?.role || 'customer',
        permissions: ['prescription.read', 'prescription.upload', 'prescription.manage'],
        iss: SERVICE_ISSUER,
        aud: SERVICE_AUDIENCE
    };
    return jwt.sign(claims, SERVICE_SECRET, { expiresIn: '15m' });
}

function sendResponse(res, status, data, message = 'Operation completed successfully') {
    const requestId = res.req?.context?.requestId || res.req?.headers?.['x-request-id'] || 'req_123';
    return res.status(status).json({
        success: true,
        data,
        message,
        requestId
    });
}

function sendError(res, status, code, message, details = []) {
    const requestId = res.req?.context?.requestId || res.req?.headers?.['x-request-id'] || 'req_123';
    return res.status(status).json({
        success: false,
        error: {
            code,
            message,
            details
        },
        requestId
    });
}

// 1. Upload Prescription
router.post('/upload', authenticateUser, upload.single('file'), async (req, res) => {
    try {
        const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;
        const customerId = req.user?.sub || req.user?.userId || req.context?.userId;
        const tenantId = req.context?.tenantId || null;
        const branchId = req.context?.branchId || req.headers['x-branch-id'] || null;

        const result = await prescriptionService.uploadPrescription({
            file: req.file || null,
            customerId,
            tenantId,
            branchId,
            notes: req.body?.notes || '',
            metadata: req.body || {},
            idempotencyKey
        });

        return sendResponse(res, 201, result, 'Prescription uploaded successfully');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'UPLOAD_FAILED', err.message);
    }
});

// 2. Analytics Summary
router.get('/analytics/summary', authenticateUser, async (req, res) => {
    try {
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId,
            userId: req.user?.sub || req.user?.userId
        };
        const summary = await prescriptionService.getAnalyticsSummary(authContext, req.query);
        return sendResponse(res, 200, summary, 'Analytics summary retrieved');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'ANALYTICS_FAILED', err.message);
    }
});

// 2b. Analytics Scan & Medicine Extraction
router.all('/analytics/scan', authenticateUser, async (req, res) => {
    try {
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId,
            userId: req.user?.sub || req.user?.userId
        };
        const params = req.method === 'POST' ? req.body : req.query;
        const result = await prescriptionService.scanPrescription(params, authContext);
        return sendResponse(res, 200, result, 'Prescription scan and verification completed');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'SCAN_FAILED', err.message);
    }
});

// 3. Hospital Match / Create
router.post('/hospitals', authenticateUser, async (req, res) => {
    try {
        if (!req.body?.name) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Hospital name is required');
        }
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId
        };
        const hospital = await prescriptionService.getOrMatchHospital(req.body, authContext);
        return sendResponse(res, 200, hospital, 'Hospital resolved');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'HOSPITAL_ERROR', err.message);
    }
});

// 4. List Prescriptions (excluding INACTIVE)
router.get('/', authenticateUser, async (req, res) => {
    try {
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId,
            customerId: req.context?.isPlatformUser || req.context?.tenantMembership ? null : (req.user?.sub || req.user?.userId)
        };
        const list = await prescriptionService.listPrescriptions(authContext, {
            page: req.query.page || 1,
            pageSize: req.query.pageSize || 20,
            status: req.query.status || null
        });
        return sendResponse(res, 200, list, 'Prescriptions retrieved successfully');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'LIST_FAILED', err.message);
    }
});

// 5. Get Prescription By ID
router.get('/:id', authenticateUser, async (req, res) => {
    try {
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId,
            customerId: req.context?.isPlatformUser || req.context?.tenantMembership ? null : (req.user?.sub || req.user?.userId)
        };
        const prescription = await prescriptionService.getPrescriptionById(req.params.id, authContext);
        if (!prescription) {
            return sendError(res, 404, 'PRESCRIPTION_NOT_FOUND', 'Prescription not found');
        }
        return sendResponse(res, 200, prescription, 'Prescription retrieved successfully');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'FETCH_FAILED', err.message);
    }
});

// 6. Customer Data Removal (State -> INACTIVE)
router.post('/:id/remove', authenticateUser, async (req, res) => {
    try {
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId,
            customerId: req.user?.sub || req.user?.userId
        };
        const reason = req.body?.reason || 'Customer requested prescription data removal';
        const result = await prescriptionService.removePrescription(req.params.id, authContext, reason);
        return sendResponse(res, 200, result, 'Prescription successfully deactivated');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'REMOVAL_FAILED', err.message);
    }
});

// 7. Human Review & Corrections (Optimistic Locking)
router.post('/:id/review', authenticateUser, async (req, res) => {
    try {
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId,
            userId: req.user?.sub || req.user?.userId
        };
        const result = await prescriptionService.reviewPrescription(req.params.id, authContext, {
            patient: req.body?.patient,
            diagnosis: req.body?.diagnosis,
            medicines: req.body?.medicines,
            expectedVersion: req.body?.expectedVersion
        });
        return sendResponse(res, 200, result, 'Prescription review completed');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'REVIEW_FAILED', err.message);
    }
});

// 8. Validate Medicines
router.post('/:id/validate-medicines', authenticateUser, async (req, res) => {
    try {
        const authContext = {
            isPlatformUser: req.context?.isPlatformUser,
            tenantId: req.context?.tenantId,
            userId: req.user?.sub || req.user?.userId
        };
        const result = await prescriptionService.validateMedicines(req.params.id, authContext);
        return sendResponse(res, 200, result, 'Medicines validated against catalog');
    } catch (err) {
        return sendError(res, err.status || 500, err.code || 'VALIDATION_FAILED', err.message);
    }
});

export default router;
