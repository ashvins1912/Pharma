import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import dataStore from '../dataStore.js';
import { getIsConnected } from '../config/db.js';
import { authenticateUser } from '../middleware/auth.js';
import ProductDiscoveryService from '../services/ProductDiscoveryService.js';
import SearchMetricIngestionService from '../services/SearchMetricIngestionService.js';
import { inventoryClient } from '../services/inventory-client/InventoryClient.js';
import { tenantService } from '../services/tenant-service/TenantService.js';
import { authorizationService } from '../authorization/AuthorizationService.js';

const router = express.Router();
const productDiscovery = new ProductDiscoveryService();
const searchMetricIngestion = new SearchMetricIngestionService();
const publicMedicine = medicine => {
    const { stockQuantity, reservedQuantity, ...visibleMedicine } = medicine;
    const availableQuantity = medicine.availableQuantity ?? medicine.stock ?? medicine.quantity ?? 0;
    const basePrice = Number(medicine.basePrice ?? medicine.mrp ?? medicine.price ?? 0);
    const discountPercentage = Math.min(100, Math.max(0, Number(medicine.discountPercentage || 0)));
    const sellingPrice = medicine.sellingPrice ?? Math.round(basePrice * (1 - discountPercentage / 100) * 100) / 100;
    return {
        ...visibleMedicine,
        basePrice,
        mrp: basePrice,
        price: sellingPrice,
        sellingPrice,
        discountPercentage,
        availableQuantity,
        stock: availableQuantity,
        quantity: availableQuantity
    };
};

// Full inventory and CRUD are protected by inventory.read / inventory.write capabilities.
router.get('/admin/inventory', authenticateUser, async (req, res) => {
    try {
        const { search, category, sort, page, limit } = req.query;
        const scope = await getVerifiedInventoryScope(req, 'inventory.read');
        const result = await inventoryClient.searchProducts({
            ...scope,
            query: search || '',
            category: category === 'All' ? '' : category || '',
            sort: sort || 'default',
            page: page || 1,
            limit: limit || 16,
            includeOutOfStock: true,
            userId: req.user?.sub || 'inventory-admin'
        });
        return res.json({
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
        return res.status(error.statusCode || 503).json({
            message: error.message || 'Failed to retrieve admin inventory.'
        });
    }
});

const getVerifiedInventoryScope = async (req, requiredPermission = 'inventory.read') => {
    const authz = req.authz || await authorizationService.resolve(req.user);
    req.authz = authz;
    if (!authorizationService.isAllowed(authz, requiredPermission)) {
        const error = new Error(`You do not have permission to ${requiredPermission === 'inventory.write' ? 'manage' : 'view'} pharmacy inventory.`);
        error.statusCode = 403;
        error.code = 'FORBIDDEN';
        throw error;
    }

    // Browser-selected scope is a request, never authorization evidence.
    // Signed tenant/branch context is resolved against active membership first.
    const platformContext = authorizationService.isPlatformContext(authz);
    // Platform operators can switch between tenants/branches in the UI. For
    // platform context, honor the explicitly selected request scope first;
    // for tenant members, signed membership context remains authoritative.
    const requestedTenantId = String(
        (platformContext
            ? req.get('x-tenant-id') || req.body?.tenantId || req.query?.tenantId || authz.tenantId
            : authz.tenantId || req.get('x-tenant-id') || req.body?.tenantId || req.query?.tenantId) || ''
    ).trim();
    const requestedBranchId = String(
        (platformContext
            ? req.get('x-branch-id') || req.body?.branchId || req.query?.branchId || authz.branchId
            : authz.branchId || req.get('x-branch-id') || req.body?.branchId || req.query?.branchId) || ''
    ).trim();

    if (!requestedTenantId || !requestedBranchId) {
        const error = new Error('Select an authorized pharmacy tenant and branch before accessing inventory.');
        error.statusCode = 403;
        error.code = 'PHARMACY_SCOPE_REQUIRED';
        throw error;
    }

    if (!authorizationService.isPlatformContext(authz)
        && !authorizationService.canAccessTenantResource(authz, requestedTenantId, requestedBranchId)) {
        const error = new Error('Your account does not have active access to the selected pharmacy branch.');
        error.statusCode = 403;
        error.code = 'TENANT_ACCESS_DENIED';
        throw error;
    }

    const [tenant, branch] = await Promise.all([
        tenantService.getTenantById(requestedTenantId),
        tenantService.getBranchById(requestedBranchId)
    ]);
    if (!tenant || tenant.status !== 'ACTIVE' || !branch || branch.status !== 'ACTIVE' || String(branch.tenantId) !== requestedTenantId) {
        const error = new Error('The selected pharmacy or branch is inactive or does not belong to this pharmacy. Select a valid branch and try again.');
        error.statusCode = 403;
        error.code = 'INVALID_PHARMACY_BRANCH';
        throw error;
    }
    return { tenantId: requestedTenantId, branchId: requestedBranchId };
};

router.post('/', authenticateUser, async (req, res) => {
    try {
        const scope = await getVerifiedInventoryScope(req, 'inventory.write');
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
        const scope = await getVerifiedInventoryScope(req, 'inventory.write');
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
        const scope = await getVerifiedInventoryScope(req, 'inventory.write');
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
        const tenantId = String(req.query.tenantId || req.context?.tenantId || '').trim();
        if (!tenantId) {
            return res.status(400).json({
                code: 'PHARMACY_SELECTION_REQUIRED',
                message: 'Select a pharmacy to view its medicine catalogue.'
            });
        }

        // A storefront can select a pharmacy before choosing a branch. Resolve
        // that tenant's default active branch (or first active branch) rather
        // than sending a tenant-only query to Inventory Service, which requires
        // an explicit tenant+branch stock scope.
        let branchId = String(req.query.branchId || req.context?.branchId || '').trim();
        if (!branchId) {
            const activeBranches = await tenantService.getBranches(tenantId, { status: 'ACTIVE' });
            // Match checkout/fulfillment branch resolution exactly: default branch
            // first, otherwise the earliest-created active branch. This prevents the
            // catalogue showing stock from one branch while checkout previews another.
            const selectedBranch = activeBranches.find(branch => branch.isDefault)
                || [...activeBranches].sort((a, b) =>
                    new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
                    || String(a._id || a.id).localeCompare(String(b._id || b.id))
                )[0];
            branchId = String(selectedBranch?.id || selectedBranch?._id || '').trim();
        }
        if (!branchId) {
            return res.status(409).json({
                code: 'ACTIVE_BRANCH_REQUIRED',
                message: 'This pharmacy has no active branch available for its medicine catalogue.'
            });
        }

        // Inventory Service is authoritative for product metadata, batch stock,
        // reservations, expiry and price. Do not cache this response: an import
        // publish must be reflected on the next catalogue read.
        const result = await inventoryClient.searchProducts({
            tenantId,
            branchId,
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

        const tenantId = String(req.query.tenantId || req.context?.tenantId || '').trim();
        const branchId = String(req.query.branchId || req.context?.branchId || '').trim();
        if (!tenantId || !branchId) {
            return res.status(400).json({ code: 'PHARMACY_BRANCH_REQUIRED', message: 'Select a pharmacy branch for product discovery.' });
        }
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const isRxRequired = req.query.isRxRequired === undefined ? null : parseBoolean(req.query.isRxRequired);
        const liveResult = await inventoryClient.searchProducts({
            tenantId, branchId,
            query: String(req.query.search || '').trim(),
            category: categories.length === 1 ? categories[0] : '',
            hideRx: false,
            includeOutOfStock: false,
            sort: 'default',
            page: 1,
            limit: 100,
            userId: req.user?.sub || 'public-discovery'
        });
        let rankedMedicines = [];
        try {
            rankedMedicines = await productDiscovery.getPrioritizedMedicines(
                { categories, subCategories },
                { activeCartSkus, priceTier },
                { page: 1, limit: 100 }
            );
        } catch (rankingError) {
            console.warn('Product discovery ranking is unavailable; using live inventory ordering:', rankingError.message);
        }
        const rankBySku = new Map(rankedMedicines.map((item, index) => [String(item.skuId || '').toUpperCase(), index]));
        const activeCartSet = new Set(activeCartSkus.map(sku => sku.toUpperCase()));
        let liveItems = (liveResult.items || []).filter(item => {
            if (activeCartSet.has(String(item.sku || '').toUpperCase())) return false;
            if (isRxRequired !== null && Boolean(item.requiresPrescription) !== isRxRequired) return false;
            const currentPrice = Number(item.sellingPrice ?? item.price ?? 0);
            if (maxPrice !== undefined && currentPrice > maxPrice) return false;
            if (categories.length && !categories.some(category => String(item.category || '').toLowerCase() === category.toLowerCase())) return false;
            return true;
        });
        liveItems.sort((left, right) => {
            const leftRank = rankBySku.get(String(left.sku || '').toUpperCase());
            const rightRank = rankBySku.get(String(right.sku || '').toUpperCase());
            if (leftRank === undefined && rightRank === undefined) return String(left.name || '').localeCompare(String(right.name || ''));
            if (leftRank === undefined) return 1;
            if (rightRank === undefined) return -1;
            return leftRank - rightRank;
        });
        const total = liveItems.length;
        const data = liveItems.slice((page - 1) * limit, page * limit).map(item => ({
            ...item,
            skuId: item.sku,
            isRxRequired: Boolean(item.requiresPrescription),
            pricing: {
                currentPrice: Number(item.sellingPrice ?? item.price ?? 0),
                listPrice: Number(item.basePrice ?? item.price ?? 0),
                discountPercentage: Number(item.discountPercentage || 0),
                priceTier: item.marginTier || 'LOW'
            }
        }));

        return res.json({ count: total, page, limit, totalPages: Math.ceil(total / limit) || 1, data });
    } catch (error) {
        console.error('Prioritized medicine discovery failed:', error);
        return res.status(error.statusCode || 500).json({
            message: error.statusCode ? error.message : 'Failed to discover medicines.'
        });
    }
});

// Admin Inventory Alerts (Tenant and Role Scoped for Data Privacy)
router.get('/alerts', authenticateUser, async (req, res) => {
    const requestId = String(req.get('x-request-id') || '').slice(0, 128) || crypto.randomUUID();
    const startedAt = Date.now();
    res.set('X-Request-Id', requestId);
    try {
        const scope = await getVerifiedInventoryScope(req, 'inventory.read').catch(err => {
            if (err.code === 'PHARMACY_SCOPE_REQUIRED') return null;
            throw err;
        });
        if (!scope) {
            return res.json({
                expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0, totalAlerts: 0,
                expired: [], expiringSoon: [], lowStock: []
            });
        }
        const alerts = await dataStore.getInventoryAlerts(3, 30, scope);
        res.set('Cache-Control', 'private, no-store');
        console.info('[InventoryAlerts] request complete', { requestId, tenantId: scope.tenantId, branchId: scope.branchId, durationMs: Date.now() - startedAt });
        return res.json(alerts);
    } catch (err) {
        console.error('[InventoryAlerts] request failed, returning safe fallback:', { requestId, durationMs: Date.now() - startedAt, code: err.code, message: err.message });
        return res.json({
            expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0, totalAlerts: 0,
            expired: [], expiringSoon: [], lowStock: []
        });
    }
});

// Inventory merge audits
router.get('/audits', authenticateUser, async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
        const scope = await getVerifiedInventoryScope(req, 'inventory.read');
        res.set('Cache-Control', 'private, no-store');
        res.json(await dataStore.getInventoryAudits(page, limit, scope));
    } catch (err) {
        console.error('Inventory audit list failed:', err);
        res.status(err.statusCode || 500).json({ message: err.message || "Failed to fetch audit logs" });
    }
});

// DEPRECATED: Legacy medicine import endpoints. Target architecture uses /api/v1/inventory/imports
const setLegacyImportDeprecation = res => {
    res.set('Deprecation', 'true');
    res.set('Sunset', '2027-01-01');
    res.set('Link', '</api/v1/inventory/imports>; rel="successor-version"');
};
const legacyImportGone = (_req, res) => {
    setLegacyImportDeprecation(res);
    return res.status(410).json({
        code: 'LEGACY_INVENTORY_IMPORT_DISABLED',
        message: 'This legacy import path is disabled. Use the staged Inventory Service workflow at /api/v1/inventory/imports.'
    });
};

// Start a durable background import job (Legacy).
router.post('/imports', authenticateUser, legacyImportGone);

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

router.post('/imports/:importId/retry', authenticateUser, legacyImportGone);

// Workbook preview is chunked and returns only a small preview/error sample.
router.post('/validate-import', authenticateUser, legacyImportGone);

// Confirm and commit validated Excel rows (Requirement 6)
router.post('/confirm-import', authenticateUser, legacyImportGone);

// Direct single-step Excel upload
router.post('/upload-excel', authenticateUser, legacyImportGone);

export default router;
