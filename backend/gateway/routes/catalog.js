/**
 * API Gateway Catalog & Branch Listing Routes (/api/v1/catalog)
 */
import express from 'express';
import { catalogService } from '../../services/catalog-service/CatalogService.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';

const router = express.Router();

// Search master catalog
router.get('/products', async (req, res, next) => {
    try {
        const { q, category } = req.query;
        const products = await catalogService.searchProducts(q, category);
        res.json({ success: true, data: products });
    } catch (err) {
        next(err);
    }
});

// Browse branch listings with live stock availability
router.get('/listings', async (req, res, next) => {
    try {
        const branchId = req.query.branchId || req.context?.branchId || 'branch-indore-central';
        const branch = await tenantService.getBranchById(branchId);
        if (!branch) {
            return res.status(404).json({ success: false, message: 'Branch not found' });
        }
        const listings = await catalogService.getBranchListings(branch.tenantId, branchId, req.query.q);
        res.json({
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
                listings
            }
        });
    } catch (err) {
        next(err);
    }
});

export default router;
