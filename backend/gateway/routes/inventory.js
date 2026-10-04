/**
 * API Gateway Inventory & Bulk Import Routes (/api/v1/inventory)
 * Single authoritative entrypoint for branch inventory and bulk Excel imports.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { catalogService } from '../../services/catalog-service/CatalogService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { requireBranchScope, requireTenantScope, requireTenantStaff } from '../../middleware/context.js';
import { config as inventoryConfig } from '../../inventory-service/src/config.js';
import { ImportJob } from '../../inventory-service/src/models.js';
import {
    buildFailureWorkbook,
    createImportJob,
    findImportJob,
    getImportFailures,
    retryImportJob
} from '../../inventory-service/src/imports.js';

const router = express.Router();

await fs.mkdir(inventoryConfig.importStorage, { recursive: true }).catch(() => {});
const upload = multer({
    storage: multer.diskStorage({
        destination: inventoryConfig.importStorage,
        filename: (_req, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: inventoryConfig.maxFileBytes || 50 * 1024 * 1024, files: 1 }
});

function requireInventoryImportPermission(req, res, next) {
    if (req.context?.isPlatformUser) return next();
    const role = req.context?.role || req.user?.app_metadata?.role;
    const permissions = req.context?.permissions || req.user?.app_metadata?.permissions || [];
    const allowedRoles = [
        'admin',
        'PLATFORM_SUPER_ADMIN',
        'TENANT_OWNER',
        'TENANT_ADMIN',
        'INVENTORY_MANAGER',
        'PHARMACIST',
        'PHARMACY_STAFF'
    ];
    if (allowedRoles.includes(role) || permissions.includes('inventory.import')) {
        return next();
    }
    return res.status(403).json({
        success: false,
        error: {
            code: 'FORBIDDEN',
            message: 'Inventory import permission (inventory.import) or pharmacy staff privileges required.',
            requestId: req.context?.requestId
        }
    });
}

// ---------------------------------------------------------------------------
// 1. Authoritative Bulk Excel Import Endpoints
// ---------------------------------------------------------------------------

// POST /api/v1/inventory/imports
router.post(
    '/imports',
    authenticateUser,
    requireTenantScope,
    requireBranchScope,
    requireInventoryImportPermission,
    upload.single('excelFile'),
    async (req, res, next) => {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'An Excel workbook is required.' });
        }
        if (!/\.(xlsx|xls)$/i.test(req.file.originalname)) {
            await fs.rm(req.file.path, { force: true }).catch(() => {});
            return res.status(400).json({ success: false, message: 'Upload an .xlsx or .xls workbook.' });
        }

        const idempotencyKey = req.get('idempotency-key') || req.headers['x-idempotency-key'];
        if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
            await fs.rm(req.file.path, { force: true }).catch(() => {});
            return res.status(400).json({ success: false, message: 'A valid Idempotency-Key header is required.' });
        }

        const tenantId = req.context.tenantId;
        const branchId = req.context.branchId;
        const uploadedBy = req.context.userId || req.user?.sub || 'user-unknown';

        try {
            const job = await createImportJob({
                file: req.file,
                fileName: req.file.originalname,
                uploadedBy,
                idempotencyKey: idempotencyKey.trim(),
                tenantId,
                branchId
            });

            return res.status(202).json({
                jobId: String(job._id),
                idempotencyKey: job.idempotencyKey,
                status: job.status,
                totalRecords: job.totalRecords || 0,
                processedRecords: job.processedRecords || 0,
                successfulRecords: job.successfulRecords || 0,
                failedRecords: job.failedRecords || 0
            });
        } catch (err) {
            await fs.rm(req.file.path, { force: true }).catch(() => {});
            if (err.statusCode === 409 || err.status === 409) {
                return res.status(409).json({ success: false, message: err.message });
            }
            next(err);
        }
    }
);

// GET /api/v1/inventory/imports/:jobId
router.get(
    '/imports/:jobId',
    authenticateUser,
    requireTenantScope,
    async (req, res, next) => {
        try {
            if (!mongoose.isValidObjectId(req.params.jobId)) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            const filter = { _id: req.params.jobId };
            if (!req.context.isPlatformUser) {
                filter.tenantId = req.context.tenantId;
            }

            const job = await findImportJob(filter);
            if (!job) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            return res.json({
                jobId: String(job._id),
                fileName: job.fileName,
                status: job.status,
                totalRecords: job.totalRecords,
                processedRecords: job.processedRecords,
                successfulRecords: job.successfulRecords,
                insertedRecords: job.insertedRecords,
                updatedRecords: job.updatedRecords,
                failedRecords: job.failedRecords,
                retryCount: job.retryCount,
                progress: job.totalRecords ? Math.round((job.processedRecords / job.totalRecords) * 1000) / 10 : 0,
                failedFileAvailable: ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.status) && job.failedRecords > 0,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                errorMessage: job.errorMessage
            });
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/v1/inventory/imports/:jobId/failures
router.get(
    '/imports/:jobId/failures',
    authenticateUser,
    requireTenantScope,
    async (req, res, next) => {
        try {
            if (!mongoose.isValidObjectId(req.params.jobId)) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            const filter = { _id: req.params.jobId };
            if (!req.context.isPlatformUser) {
                filter.tenantId = req.context.tenantId;
            }

            const job = await findImportJob(filter);
            if (!job) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            const failures = await getImportFailures(
                req.params.jobId,
                !req.context.isPlatformUser ? req.context.tenantId : null
            );
            return res.json({ failures });
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/v1/inventory/imports/:jobId/failures/download
router.get(
    '/imports/:jobId/failures/download',
    authenticateUser,
    requireTenantScope,
    async (req, res, next) => {
        try {
            if (!mongoose.isValidObjectId(req.params.jobId)) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            const filter = { _id: req.params.jobId };
            if (!req.context.isPlatformUser) {
                filter.tenantId = req.context.tenantId;
            }

            const job = await findImportJob(filter);
            if (!job) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            const failures = await getImportFailures(
                req.params.jobId,
                !req.context.isPlatformUser ? req.context.tenantId : null
            );
            if (!failures.length) {
                return res.status(404).json({ success: false, message: 'This import has no failed records.' });
            }

            res.set({
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="Inventory_Failures_${req.params.jobId}.xlsx"`,
                'Cache-Control': 'private, no-store'
            });
            return res.send(buildFailureWorkbook(failures));
        } catch (err) {
            next(err);
        }
    }
);

// POST /api/v1/inventory/imports/:jobId/retry
router.post(
    '/imports/:jobId/retry',
    authenticateUser,
    requireTenantScope,
    requireInventoryImportPermission,
    async (req, res, next) => {
        try {
            if (!mongoose.isValidObjectId(req.params.jobId)) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            const idempotencyKey = req.get('idempotency-key') || req.headers['x-idempotency-key'];
            if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
                return res.status(400).json({ success: false, message: 'A valid Idempotency-Key header is required to retry.' });
            }

            const job = await retryImportJob(
                req.params.jobId,
                req.context.userId || req.user?.sub || 'user-unknown',
                idempotencyKey.trim(),
                !req.context.isPlatformUser ? req.context.tenantId : null
            );
            if (!job) {
                return res.status(404).json({ success: false, message: 'Import job was not found.' });
            }

            return res.status(202).json({ jobId: String(job._id), status: job.status });
        } catch (err) {
            if (err.statusCode || err.status) {
                return res.status(err.statusCode || err.status).json({ success: false, message: err.message });
            }
            next(err);
        }
    }
);

// ---------------------------------------------------------------------------
// 2. Existing Branch Inventory & Adjustment Endpoints (Preserved for compatibility)
// ---------------------------------------------------------------------------

// Get branch inventory
router.get('/', authenticateUser, requireTenantScope, async (req, res, next) => {
    try {
        const branchId = req.query.branchId || req.context.branchId;
        if (!branchId) {
            return res.status(400).json({ success: false, message: 'branchId is required' });
        }
        const inventory = await catalogService.getBranchInventory(req.context.tenantId, branchId);
        res.json({ success: true, data: inventory });
    } catch (err) {
        next(err);
    }
});

// Adjust stock count
router.post('/adjust', authenticateUser, requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const { branchId, productId, newAvailableQty } = req.body;
        const inv = await catalogService.adjustInventory(
            req.context.tenantId,
            branchId || req.context.branchId,
            productId,
            newAvailableQty,
            req.context
        );
        res.json({ success: true, data: inv });
    } catch (err) {
        next(err);
    }
});

// In-memory Bulk Import
router.post('/bulk-import', authenticateUser, requireTenantScope, requireTenantStaff, async (req, res, next) => {
    try {
        const { branchId, records } = req.body;
        if (!Array.isArray(records) || !records.length) {
            return res.status(400).json({ success: false, message: 'records array is required' });
        }
        const job = await catalogService.startBulkImport(
            req.context.tenantId,
            branchId || req.context.branchId,
            records,
            req.context
        );
        res.status(202).json({ success: true, data: job });
    } catch (err) {
        next(err);
    }
});

router.get('/bulk-import/:jobId', authenticateUser, requireTenantScope, async (req, res, next) => {
    try {
        const tenantId = req.context.isPlatformUser ? null : req.context.tenantId;
        const job = await catalogService.getBulkImportJob(req.params.jobId, tenantId);
        if (!job) return res.status(404).json({ success: false, message: 'Import job not found' });
        res.json({ success: true, data: job });
    } catch (err) {
        next(err);
    }
});

export default router;
