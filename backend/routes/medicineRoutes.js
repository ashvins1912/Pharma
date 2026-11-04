import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import { getIsConnected } from '../config/db.js';
import { authenticateUser } from '../middleware/auth.js';
import ProductDiscoveryService from '../services/ProductDiscoveryService.js';
import SearchMetricIngestionService from '../services/SearchMetricIngestionService.js';
import { inventoryClient } from '../services/inventory-client/InventoryClient.js';
import { tenantService } from '../services/tenant-service/TenantService.js';

const router = express.Router();
const importFileLimit = Number.parseInt(process.env.INVENTORY_IMPORT_MAX_FILE_BYTES || '', 10);
const uploadMemory = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: Number.isInteger(importFileLimit) && importFileLimit > 0
            ? importFileLimit
            : 100 * 1024 * 1024
    }
});
const productDiscovery = new ProductDiscoveryService();
const searchMetricIngestion = new SearchMetricIngestionService();
const publicMedicine = medicine => {
    const { stockQuantity, reservedQuantity, ...visibleMedicine } = medicine;
    const availableQuantity = medicine.availableQuantity ?? medicine.stock ?? medicine.quantity ?? 0;
    return {
        ...visibleMedicine,
        availableQuantity,
        stock: availableQuantity,
        quantity: availableQuantity
    };
};

const getErrorStatus = error => error.statusCode
    || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500);

// Full inventory and CRUD are protected by inventory.read / inventory.write capabilities.
router.get('/admin/inventory', authenticateUser, async (req, res) => {
    try {
        const { search, category, sort, page, limit } = req.query;
        const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
        const isPlatformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        const tenantId = isPlatformAdmin
            ? String(req.user?.tenantId || req.user?.app_metadata?.tenantId || req.query.tenantId || '').trim() || null
            : String(req.user?.tenantId || req.user?.app_metadata?.tenantId || '').trim();
        if (!isPlatformAdmin && !tenantId) {
            return res.status(403).json({ message: 'An active pharmacy tenant is required to view inventory.' });
        }
        const result = await inventoryClient.searchProducts({
            tenantId,
            branchId: req.user?.branchId || req.context?.branchId || null,
            query: search || '',
            category: category === 'All' ? '' : category || '',
            sort: sort || 'default',
            page: page || 1,
            limit: limit || 16,
            includeOutOfStock: true,
            userId: req.user?.sub || 'inventory-admin'
        });
        res.json({
            medicines: result.items || [],
            total: result.total || 0,
            page: result.page || Number(page) || 1,
            limit: result.limit || Number(limit) || 16,
            totalPages: result.pages || 1,
            isSearching: Boolean(search && String(search).trim()),
            outOfStockHidden: false
        });
    } catch (error) {
        console.error('Admin inventory retrieval failed:', error);
        res.status(500).json({ message: 'Failed to retrieve admin inventory.' });
    }
});

const getVerifiedInventoryScope = async req => {
    const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
    const isPlatformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
    const tenantId = String(
        req.user?.tenantId || req.user?.app_metadata?.tenantId
        || (isPlatformAdmin ? req.get('x-tenant-id') || req.body?.tenantId : '')
        || ''
    ).trim();
    const branchId = String(
        req.user?.branchId || req.context?.branchId
        || req.get('x-branch-id') || req.body?.branchId || ''
    ).trim();
    if (!tenantId || !branchId) {
        const error = new Error('Select an authorized pharmacy tenant and branch before changing catalogue inventory.');
        error.statusCode = 403;
        throw error;
    }
    const branch = await tenantService.getBranchById(branchId);
    if (!branch || String(branch.tenantId) !== tenantId) {
        const error = new Error('The selected branch does not belong to the authorized pharmacy tenant.');
        error.statusCode = 403;
        throw error;
    }
    return { tenantId, branchId };
};

router.post('/', authenticateUser, async (req, res) => {
    try {
        const scope = await getVerifiedInventoryScope(req);
        const result = await inventoryClient.createProduct({
            product: req.body || {},
            tenantId: scope.tenantId,
            branchId: scope.branchId,
            userId: req.user.sub
        });
        return res.status(201).json(result);
    } catch (error) {
        console.error('Inventory Service product creation failed:', error);
        return res.status(error.statusCode || 503).json({ message: error.message || 'Could not create inventory product.' });
    }
});

router.put('/:medicineId', authenticateUser, async (req, res) => {
    try {
        const scope = getVerifiedInventoryScope(req);
        const result = await inventoryClient.updateProduct({
            productId: req.params.medicineId,
            product: req.body || {},
            tenantId: scope.tenantId,
            branchId: scope.branchId,
            userId: req.user.sub
        });
        return res.json(result);
    } catch (error) {
        console.error('Inventory Service product update failed:', error);
        return res.status(error.statusCode || 503).json({ message: error.message || 'Could not update inventory product.' });
    }
});

router.delete('/:medicineId', authenticateUser, async (req, res) => {
    try {
        const scope = getVerifiedInventoryScope(req);
        const result = await inventoryClient.archiveProduct({
            productId: req.params.medicineId,
            tenantId: scope.tenantId,
            branchId: scope.branchId,
            userId: req.user.sub
        });
        return res.json(result);
    } catch (error) {
        console.error('Inventory Service product archival failed:', error);
        return res.status(error.statusCode || 503).json({ message: error.message || 'Could not archive inventory product.' });
    }
});

// Public catalog search, filter & pagination
router.get('/', async (req, res) => {
    try {
        const { search, hideRx, category, sort, page, limit, paginate } = req.query;
        const tenantId = String(req.query.tenantId || '').trim();
        if (!tenantId) {
            return res.status(400).json({
                code: 'PHARMACY_SELECTION_REQUIRED',
                message: 'Select a pharmacy to view its medicine catalogue.'
            });
        }
        // Inventory Service is authoritative for product metadata, batch stock,
        // reservations, expiry and price. Do not cache this response: an import
        // publish must be reflected on the next catalogue read.
        const result = await inventoryClient.searchProducts({
            tenantId,
            branchId: req.query.branchId || req.context?.branchId || null,
            query: search || '',
            category: category === 'All' ? '' : category || '',
            hideRx: hideRx === 'true' || hideRx === true,
            sort: sort || 'default',
            page: page || 1,
            limit: limit || 16,
            includeOutOfStock: false,
            userId: req.context?.userId || 'public-catalog'
        });
        const medicines = (result.items || []).map(publicMedicine);
        if (typeof search === 'string' && search.trim()) {
            const skuIds = medicines.map(medicine => medicine.sku || medicine.code)
                .filter(sku => typeof sku === 'string' && sku.trim());
            void searchMetricIngestion.recordImpressionsForSkus({ skuIds })
                .catch(error => console.error('Medicine search impression recording failed:', error));
        }
        if (paginate === 'false') return res.json(medicines);
        return res.json({
            medicines,
            total: result.total || 0,
            page: result.page || Number(page) || 1,
            limit: result.limit || Number(limit) || 16,
            totalPages: result.pages || 1,
            isSearching: Boolean(search && String(search).trim()),
            outOfStockHidden: result.outOfStockHidden ?? !(search && String(search).trim())
        });
    } catch (error) {
        console.error('Inventory Service public catalogue retrieval failed:', {
            code: error.code || error.name,
            statusCode: error.statusCode || null
        });
        return res.status(error.statusCode || 503).json({
            code: error.code || 'INVENTORY_SERVICE_UNAVAILABLE',
            message: error.statusCode && error.statusCode < 500
                ? error.message
                : 'The medicine catalogue is temporarily unavailable.'
        });
    }
});

router.get('/discovery', async (req, res) => {
    try {
        const readList = value => {
            if (value === undefined) return [];
            const values = Array.isArray(value) ? value : [value];
            if (values.some(item => typeof item !== 'string')) {
                const error = new TypeError('Discovery filters must be strings.');
                error.statusCode = 400;
                throw error;
            }
            return values.flatMap(item => item.split(',')).map(item => item.trim()).filter(Boolean);
        };
        const parseBoolean = value => {
            if (value === undefined) return undefined;
            if (value === 'true') return true;
            if (value === 'false') return false;
            const error = new TypeError('isRxRequired must be true or false.');
            error.statusCode = 400;
            throw error;
        };
        const categories = readList(req.query.category);
        const subCategories = readList(req.query.subCategory);
        const activeCartSkus = readList(req.query.cartSkus);
        if (categories.length > 20 || subCategories.length > 20 || activeCartSkus.length > 50) {
            return res.status(400).json({ message: 'Too many discovery filter values.' });
        }

        const maxPrice = req.query.maxPrice === undefined ? undefined : Number(req.query.maxPrice);
        if (maxPrice !== undefined && (!Number.isFinite(maxPrice) || maxPrice < 0)) {
            return res.status(400).json({ message: 'maxPrice must be a non-negative number.' });
        }

        const priceTier = req.query.priceTier;
        if (priceTier !== undefined && !['LOW', 'MID', 'HIGH'].includes(priceTier)) {
            return res.status(400).json({ message: 'priceTier must be LOW, MID, or HIGH.' });
        }

        const medicines = await productDiscovery.getPrioritizedMedicines(
            {
                categories,
                subCategories,
                maxPrice,
                isRxRequired: parseBoolean(req.query.isRxRequired)
            },
            { activeCartSkus, priceTier },
            { page: req.query.page, limit: req.query.limit }
        );

        return res.json({ count: medicines.length, data: medicines });
    } catch (error) {
        console.error('Prioritized medicine discovery failed:', error);
        return res.status(error.statusCode || 500).json({
            message: error.statusCode ? error.message : 'Failed to discover medicines.'
        });
    }
});

// Admin Inventory Alerts (Tenant and Role Scoped for Data Privacy)
router.get('/alerts', authenticateUser, async (req, res) => {
    try {
        const role = req.user?.role || req.user?.app_metadata?.role;
        const isStaff = ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin', 'TENANT_ADMIN', 'TENANT_OWNER', 'pharmacy', 'PHARMACIST', 'PHARMACY_STAFF'].includes(role) || req.user?.permissions?.includes('*') || req.user?.permissions?.includes('inventory.read');
        if (!isStaff) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Dispensary alerts are restricted to authorized pharmacy staff.' }
            });
        }
        const tenantId = req.context?.tenantId || req.user?.tenantId || null;
        const branchId = req.context?.branchId || req.user?.branchId || null;
        const alerts = await dataStore.getInventoryAlerts(3, 30, { tenantId, branchId });
        res.json(alerts);
    } catch (err) {
        console.error("Error fetching inventory alerts:", err);
        res.status(500).json({ message: "Failed to fetch alerts" });
    }
});

// Inventory merge audits
router.get('/audits', authenticateUser, async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
        res.json(await dataStore.getInventoryAudits(page, limit));
    } catch (err) {
        console.error('Inventory audit list failed:', err);
        res.status(500).json({ message: "Failed to fetch audit logs" });
    }
});

// DEPRECATED: Legacy medicine import endpoints. Target architecture uses /api/v1/inventory/imports
const setLegacyImportDeprecation = res => {
    res.set('Deprecation', 'true');
    res.set('Sunset', '2027-01-01');
    res.set('Link', '</api/v1/inventory/imports>; rel="successor-version"');
};

// Start a durable background import job (Legacy).
router.post('/imports', authenticateUser, uploadMemory.single('excelFile'), async (req, res) => {
    setLegacyImportDeprecation(res);
    try {
        if (!req.file?.buffer) return res.status(400).json({ message: 'No Excel file provided.' });
        if (!/\.(xlsx|xls)$/i.test(req.file.originalname)) {
            return res.status(400).json({ message: 'Upload an .xlsx or .xls workbook.' });
        }
        const { createInventoryImport, enqueueInventoryImport } =
            await import('../services/InventoryImportService.js');
        const job = await createInventoryImport({
            fileName: req.file.originalname,
            buffer: req.file.buffer,
            adminId: req.user.sub
        });
        enqueueInventoryImport(job._id);
        return res.status(202).json({
            importId: String(job._id),
            status: job.status,
            totalRecords: 0,
            processedRecords: 0,
            successfulRecords: 0,
            failedRecords: 0,
            failedFileAvailable: false
        });
    } catch (error) {
        console.error('Inventory import job creation failed:', {
            adminId: req.user?.sub,
            fileName: req.file?.originalname,
            code: error.code || error.name,
            message: error.message
        });
        return res.status(error.statusCode || 500).json({
            message: error.statusCode ? error.message : 'Could not start inventory import.'
        });
    }
});

router.get('/imports/:importId/status', authenticateUser, async (req, res) => {
    setLegacyImportDeprecation(res);
    if (!mongoose.isValidObjectId(req.params.importId)) {
        return res.status(404).json({ message: 'Inventory import was not found.' });
    }
    try {
        const { getInventoryImportStatus } = await import('../services/InventoryImportService.js');
        const job = await getInventoryImportStatus(req.params.importId, req.user.sub);
        if (!job) return res.status(404).json({ message: 'Inventory import was not found.' });
        return res.json({
            importId: String(job._id),
            fileName: job.fileName,
            status: job.status,
            totalRecords: job.totalRecords,
            processedRecords: job.processedRecords,
            successfulRecords: job.successfulRecords,
            failedRecords: job.failedRecords,
            progress: job.totalRecords
                ? Math.round((job.processedRecords / job.totalRecords) * 1000) / 10
                : 0,
            failedFileAvailable: job.status === 'COMPLETED_WITH_ERRORS' && job.failedRecords > 0,
            errorMessage: job.errorMessage || undefined
        });
    } catch (error) {
        console.error('Inventory import status retrieval failed:', error);
        return res.status(500).json({ message: 'Could not retrieve inventory import status.' });
    }
});

router.get('/imports/:importId/failed-records', authenticateUser, async (req, res) => {
    setLegacyImportDeprecation(res);
    if (!mongoose.isValidObjectId(req.params.importId)) {
        return res.status(404).json({ message: 'Inventory import was not found.' });
    }
    try {
        const { buildFailedInventoryWorkbook, getInventoryImportFailedRows } =
            await import('../services/InventoryImportService.js');
        const result = await getInventoryImportFailedRows(req.params.importId, req.user.sub);
        if (!result) return res.status(404).json({ message: 'Inventory import was not found.' });
        if (!result.rows.length) return res.status(404).json({ message: 'This import has no failed records.' });
        const workbook = buildFailedInventoryWorkbook(result.rows);
        const date = new Date().toISOString().slice(0, 10);
        const fileName = `Failed_Inventory_Import_${date}.xlsx`;
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Cache-Control': 'private, no-store'
        });
        return res.send(workbook);
    } catch (error) {
        console.error('Failed inventory report generation failed:', {
            importId: req.params.importId,
            adminId: req.user?.sub,
            code: error.code || error.name
        });
        return res.status(error.statusCode || 500).json({
            message: error.statusCode ? error.message : 'Could not generate failed-record workbook.'
        });
    }
});

router.post('/imports/:importId/retry', authenticateUser, async (req, res) => {
    setLegacyImportDeprecation(res);
    if (!mongoose.isValidObjectId(req.params.importId)) {
        return res.status(404).json({ message: 'Inventory import was not found.' });
    }
    try {
        const { retryInventoryImport } = await import('../services/InventoryImportService.js');
        const job = await retryInventoryImport(req.params.importId, req.user.sub);
        if (!job) return res.status(404).json({ message: 'A retryable import was not found.' });
        return res.status(202).json({ importId: String(job._id), status: 'QUEUED' });
    } catch (error) {
        console.error('Inventory import retry failed:', error);
        return res.status(500).json({ message: 'Could not retry inventory import.' });
    }
});

// Workbook preview is chunked and returns only a small preview/error sample.
router.post('/validate-import', authenticateUser, uploadMemory.single('excelFile'), async (req, res) => {
    setLegacyImportDeprecation(res);
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ message: "No Excel file provided." });
        }
        const { previewInventoryWorkbook } = await import('../services/InventoryImportService.js');
        return res.json(previewInventoryWorkbook(req.file.buffer));
    } catch (err) {
        console.error("Workbook validation error:", err);
        res.status(400).json({ message: "Workbook validation failed: " + err.message });
    }
});

// Confirm and commit validated Excel rows (Requirement 6)
router.post('/confirm-import', authenticateUser, async (req, res) => {
    setLegacyImportDeprecation(res);
    try {
        const { rows } = req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "No valid rows provided for import." });
        }
        const { createInventoryImportFromRows } = await import('../services/InventoryImportService.js');
        const job = await createInventoryImportFromRows({
            rows,
            fileName: 'Confirmed_inventory_rows.xlsx',
            adminId: req.user.sub
        });
        return res.status(202).json({ importId: String(job._id), status: job.status });
    } catch (err) {
        console.error("Import confirmation error:", err);
        res.status(500).json({ message: "Failed to import rows: " + err.message });
    }
});

// Direct single-step Excel upload
router.post('/upload-excel', authenticateUser, uploadMemory.single('excelFile'), async (req, res) => {
    setLegacyImportDeprecation(res);
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ message: "No Excel file provided." });
        }
        const { createInventoryImport, enqueueInventoryImport } =
            await import('../services/InventoryImportService.js');
        const job = await createInventoryImport({
            fileName: req.file.originalname,
            buffer: req.file.buffer,
            adminId: req.user.sub
        });
        enqueueInventoryImport(job._id);
        return res.status(202).json({ importId: String(job._id), status: job.status });
    } catch (e) {
        console.error("Direct Excel upload error:", e);
        res.status(500).json({ message: "Excel import data stream parsing failed: " + e.message });
    }
});

export default router;
