/**
 * API Gateway Global Customer & Tenant Profile Routes (/api/v1/customers)
 */
import express from 'express';
import { identityService } from '../../services/identity-service/IdentityService.js';
import { authenticateUser } from '../../middleware/auth.js';

const router = express.Router();

// Idempotently ensure the authenticated user has a canonical customer profile.
// This endpoint also supports deployments where CUSTOMER_SERVICE_URL is not configured
// and the API Gateway falls back to the main backend.
router.post('/ensure', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId, {
            name: req.body?.name || req.user.user_metadata?.name || req.user.name,
            email: req.body?.email || req.user.email,
            phone: req.body?.phone || req.user.user_metadata?.mobile || req.user.mobile
        });
        res.status(200).json({ success: true, data: customer });
    } catch (err) {
        next(err);
    }
});

// Get authenticated customer profile
router.get('/me', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId, {
            name: req.user.user_metadata?.name || req.user.name,
            email: req.user.email,
            phone: req.user.user_metadata?.mobile || req.user.mobile
        });
        res.json({ success: true, data: customer });
    } catch (err) {
        next(err);
    }
});

// Get customer tenant relationship profiles across all pharmacies
router.get('/me/tenant-profiles', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId);
        const profiles = await identityService.getCustomerTenantProfiles(customer.id);
        res.json({ success: true, data: profiles });
    } catch (err) {
        next(err);
    }
});

// Get customer profile at a specific pharmacy tenant
router.get('/me/tenant-profile', authenticateUser, async (req, res, next) => {
    try {
        const tenantId = req.query.tenantId || req.context.tenantId;
        if (!tenantId) {
            return res.status(400).json({ success: false, message: 'tenantId is required' });
        }
        const customer = await identityService.getOrCreateCustomer(req.context.userId);
        const profile = await identityService.getOrCreateTenantProfile(customer.id, tenantId);
        res.json({ success: true, data: profile });
    } catch (err) {
        next(err);
    }
});

// Saved Delivery Addresses
router.get('/me/addresses', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId);
        const addresses = await identityService.getCustomerAddresses(customer.id);
        res.json({ success: true, data: addresses });
    } catch (err) {
        next(err);
    }
});

router.post('/me/addresses', authenticateUser, async (req, res, next) => {
    try {
        const customer = await identityService.getOrCreateCustomer(req.context.userId);
        const address = await identityService.addCustomerAddress(customer.id, req.body);
        res.status(201).json({ success: true, data: address });
    } catch (err) {
        next(err);
    }
});

export default router;
