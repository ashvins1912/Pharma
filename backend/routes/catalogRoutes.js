import express from 'express';
import { CatalogBuilderService } from '../services/CatalogBuilderService.js';
import CatalogCategory from '../models/CatalogCategory.js';
import CatalogImportBatch from '../models/CatalogImportBatch.js';
import CatalogProduct from '../models/CatalogProduct.js';
import { authenticateUser } from '../middleware/auth.js';
import { getIsConnected } from '../config/db.js';

const router = express.Router();

/**
 * Helper to resolve tenantId from auth user or headers
 */
const getTenantScope = (req) => {
    return req.user?.tenantId || req.headers['x-tenant-id'] || 'tenant-ashvin-main';
};

/**
 * GET /api/catalog/products
 * Fetch tenant-isolated catalog products with search, pagination, category filtering
 */
router.get('/products', async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        const result = await CatalogBuilderService.getTenantCatalog(tenantId, req.query);
        res.json(result);
    } catch (error) {
        console.error('[CatalogRoutes] GET /products error:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch product catalog' });
    }
});

/**
 * GET /api/catalog/products/:id
 * Fetch single catalog product by ID
 */
router.get('/products/:id', async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        if (!getIsConnected()) {
            return res.status(404).json({ message: 'Product not found' });
        }
        const product = await CatalogProduct.findById(req.params.id).lean();
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        console.error('[CatalogRoutes] GET /products/:id error:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch product' });
    }
});

/**
 * POST /api/catalog/products
 * Add a new custom product to tenant catalog (runs duplicate detection algorithm)
 */
router.post('/products', authenticateUser, async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        const { forceSave = false } = req.body;
        
        const product = await CatalogBuilderService.createProduct(tenantId, req.body, { forceSave });
        res.status(201).json({
            message: 'Product successfully added to tenant catalog',
            product
        });
    } catch (error) {
        if (error.statusCode === 409) {
            return res.status(409).json({
                message: error.message,
                duplicates: error.duplicates
            });
        }
        console.error('[CatalogRoutes] POST /products error:', error);
        res.status(500).json({ message: error.message || 'Failed to create product' });
    }
});

/**
 * POST /api/catalog/similarity-check
 * Run technical algorithm to check for potential duplicate catalog products
 */
router.post('/similarity-check', async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        const result = await CatalogBuilderService.checkProductSimilarity(tenantId, req.body);
        res.json(result);
    } catch (error) {
        console.error('[CatalogRoutes] POST /similarity-check error:', error);
        res.status(500).json({ message: error.message || 'Failed to check product similarity' });
    }
});

/**
 * POST /api/catalog/variant-matrix
 * Generate variant SKU permutations algorithmically
 */
router.post('/variant-matrix', (req, res) => {
    try {
        const { baseSKU = 'SKU-MED', baseName = 'Product', basePrice = 100, options = {} } = req.body;
        const variants = CatalogBuilderService.generateVariantMatrix(baseSKU, baseName, Number(basePrice), options);
        res.json({ variants });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to generate variant matrix' });
    }
});

/**
 * POST /api/catalog/builder/bulk-import
 * Process Product Catalog Builder CSV/JSON bulk import payload
 */
router.post('/builder/bulk-import', authenticateUser, async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        const { items = [], fileName = 'catalog_import.csv' } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Items array is required for bulk catalog import' });
        }

        const result = await CatalogBuilderService.processBulkCatalogImport(
            tenantId,
            items,
            fileName,
            req.user?.name || 'Tenant Admin'
        );

        res.json(result);
    } catch (error) {
        console.error('[CatalogRoutes] POST /builder/bulk-import error:', error);
        res.status(500).json({ message: error.message || 'Failed to process bulk catalog import' });
    }
});

/**
 * GET /api/catalog/import-batches
 * Get history of bulk catalog builder batches
 */
router.get('/import-batches', authenticateUser, async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        if (!getIsConnected()) {
            return res.json([]);
        }
        const batches = await CatalogImportBatch.find({ tenantId }).sort({ createdAt: -1 }).limit(20).lean();
        res.json(batches);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch import batches' });
    }
});

/**
 * GET /api/catalog/categories
 * List hierarchical catalog categories
 */
router.get('/categories', async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        let categories = [];
        if (getIsConnected()) {
            categories = await CatalogCategory.find({
                $or: [{ tenantId }, { tenantId: null }]
            }).sort({ sortOrder: 1, name: 1 }).lean();
        }
        if (categories.length === 0) {
            categories = [
                { _id: 'cat-1', name: 'Pain & Fever', slug: 'pain-fever', icon: '💊' },
                { _id: 'cat-2', name: 'Antibiotics', slug: 'antibiotics', icon: '🔬' },
                { _id: 'cat-3', name: 'Allergy & Cold', slug: 'allergy-cold', icon: '🤧' },
                { _id: 'cat-4', name: 'Vitamins & Supplements', slug: 'vitamins', icon: '⚡' },
                { _id: 'cat-5', name: 'Digestion & Acidity', slug: 'digestion', icon: '🫄' },
                { _id: 'cat-6', name: 'Wellness & First Aid', slug: 'first-aid', icon: '🩹' },
                { _id: 'cat-7', name: 'Cardiac & Hypertension', slug: 'cardiac', icon: '🫀' },
                { _id: 'cat-8', name: 'Diabetes & Endocrine', slug: 'diabetes', icon: '🩸' }
            ];
        }
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch catalog categories' });
    }
});

/**
 * POST /api/catalog/categories
 * Create new catalog category
 */
router.post('/categories', authenticateUser, async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        const { name, slug, description, icon, parentId } = req.body;

        if (!name || !slug) {
            return res.status(400).json({ message: 'Category name and slug are required' });
        }

        let category;
        if (getIsConnected()) {
            category = await CatalogCategory.create({
                tenantId,
                name: name.trim(),
                slug: slug.trim().toLowerCase(),
                description: description || '',
                icon: icon || '💊',
                parentId: parentId || null
            });
        } else {
            category = { _id: `cat-${Date.now()}`, tenantId, name, slug, icon };
        }
        res.status(201).json(category);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to create category' });
    }
});

/**
 * GET /api/catalog/master-products
 * Fetch global master catalog for 1-click pharmacy store linking
 */
router.get('/master-products', async (req, res) => {
    try {
        const result = await CatalogBuilderService.getMasterCatalog(req.query);
        res.json(result);
    } catch (error) {
        console.error('[CatalogRoutes] GET /master-products error:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch master catalog' });
    }
});

/**
 * POST /api/catalog/products/:id/link-tenant
 * 1-Click Link Master Product to Pharmacy Tenant Store with custom overrides
 */
router.post('/products/:id/link-tenant', authenticateUser, async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        const result = await CatalogBuilderService.linkMasterProductToTenant(tenantId, req.params.id, req.body);
        res.json(result);
    } catch (error) {
        console.error('[CatalogRoutes] POST /products/:id/link-tenant error:', error);
        res.status(500).json({ message: error.message || 'Failed to link master product' });
    }
});

/**
 * PATCH /api/catalog/products/:id/quick-update
 * Quick inline update for stock, price, or publish status
 */
router.patch('/products/:id/quick-update', authenticateUser, async (req, res) => {
    try {
        const tenantId = getTenantScope(req);
        const result = await CatalogBuilderService.quickUpdateTenantProduct(tenantId, req.params.id, req.body);
        res.json(result);
    } catch (error) {
        console.error('[CatalogRoutes] PATCH /products/:id/quick-update error:', error);
        res.status(500).json({ message: error.message || 'Failed to update product' });
    }
});

export default router;
