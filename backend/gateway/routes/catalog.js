/**
 * Public catalog facade.
 *
 * Product/stock authority lives in Inventory Service. This router only translates
 * the stable /api/v1/catalog contract to the Inventory API.
 */
import express from 'express';
import { inventoryClient } from '../../services/inventory-client/InventoryClient.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';

const router = express.Router();
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/products', asyncHandler(async (req, res) => {
    const result = await inventoryClient.searchProducts({
        tenantId: req.query.tenantId || req.context?.tenantId || null,
        branchId: req.query.branchId || req.context?.branchId || null,
        query: req.query.q || '',
        category: req.query.category || '',
        page: req.query.page || 1,
        limit: req.query.limit || 50,
        userId: req.context?.userId || 'backend'
    });
    return res.json({ success: true, data: result.items || [] });
}));

router.get('/unified', asyncHandler(async (req, res) => {
    const tenantId = req.query.tenantId || req.context?.tenantId || 'tenant-ashvin-main';
    const branchId = req.query.branchId || req.context?.branchId || 'branch-indore-central';
    const result = await inventoryClient.searchProducts({
        tenantId,
        branchId,
        query: req.query.search || '',
        category: req.query.category || '',
        page: req.query.page || 1,
        limit: req.query.limit || 50,
        userId: req.context?.userId || 'backend'
    });
    return res.json({
        success: true,
        data: {
            items: result.items || [],
            total: result.total || 0,
            tenantId,
            branchId
        }
    });
}));

router.get('/products/:sku', asyncHandler(async (req, res) => {
    const tenantId = req.query.tenantId || req.context?.tenantId || null;
    const branchId = req.query.branchId || req.context?.branchId || null;
    const result = await inventoryClient.lookup({
        skus: [req.params.sku],
        tenantId,
        branchId,
        userId: req.context?.userId || 'backend'
    });
    const item = (result.items || [])[0];
    if (!item) return res.status(404).json({ success: false, message: 'Product not found' });
    return res.json({ success: true, data: item });
}));

router.get('/listings', asyncHandler(async (req, res) => {
    const branchId = req.query.branchId || req.context?.branchId || 'branch-indore-central';
    const branch = await tenantService.getBranchById(branchId);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const result = await inventoryClient.searchProducts({
        tenantId: branch.tenantId,
        branchId,
        query: req.query.q || '',
        category: req.query.category || '',
        page: req.query.page || 1,
        limit: req.query.limit || 100,
        userId: req.context?.userId || 'backend'
    });

    return res.json({
        success: true,
        data: {
            branch: {
                id: branch.id,
                name: branch.name,
                tenantId: branch.tenantId,
                serviceRadiusKm: branch.serviceRadiusKm,
                minimumOrderValue: branch.minimumOrderValue,
                freeDeliveryAbove: branch.freeDeliveryAbove,
                deliveryFee: branch.deliveryFee
            },
            listings: result.items || []
        }
    });
}));

export default router;
