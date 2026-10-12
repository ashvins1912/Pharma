/**
 * Vendor & Onboarding Public and Admin Gateway Routes
 * Implements exact JSON response contracts:
 * - POST /vendors (Admin creates vendor)
 * - POST /vendors/:vendorId/onboarding/invite
 * - POST /vendors/:vendorId/onboarding/resend
 * - GET /vendors/:vendorId/onboarding/status
 * - GET /vendor/onboarding/:token (Public rate-limited)
 * - POST /vendor/onboarding/:token/complete (Public rate-limited)
 */
import express from 'express';
import { vendorService } from '../../services/vendor-service/VendorService.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import { onboardingLimiter } from '../../middleware/rateLimiter.js';
import { sendSuccess, sendError } from '../../shared/responses.js';
import { setSessionCookies } from '../../security/sessionCookie.js';
import { authService } from '../../services/identity-service/AuthService.js';

const router = express.Router();

/**
 * -----------------------------------------------------------
 * Public Onboarding Endpoints
 * -----------------------------------------------------------
 */

/**
 * GET /vendor/onboarding/:token
 * Public endpoint to fetch pre-filled vendor details and requirements
 */
router.get('/onboarding/:token', onboardingLimiter, async (req, res) => {
    try {
        const details = await vendorService.getOnboardingDetails(req.params.token);
        return sendSuccess(res, {
            data: details,
            message: 'Onboarding details retrieved',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'INVALID_ONBOARDING_TOKEN',
            message: err.message || 'The onboarding link is invalid or has expired.',
            details: err.details || [],
            statusCode: err.status || 401,
            req
        });
    }
});

/**
 * POST /vendor/onboarding/:token/complete
 * Public endpoint to complete onboarding and create Tenant + User + Membership
 */
router.post('/onboarding/:token/complete', onboardingLimiter, async (req, res) => {
    try {
        const result = await vendorService.completeOnboarding(req.params.token, req.body);

        // Issue the canonical Pharma RS256 session only after the tenant membership exists.
        const accessToken = await authService.createAuthToken({
            ...result.user,
            id: result.user.id,
            userId: result.user.id,
            role: 'TENANT_ADMIN',
            roles: ['TENANT_ADMIN'],
            tenantId: result.tenant.id,
            accountStatus: 'ACTIVE',
            profileCompleted: true,
            status: 'ACTIVE'
        });
        setSessionCookies(res, { accessToken });

        return sendSuccess(res, {
            data: {
                ...result,
                accessToken
            },
            message: 'Vendor onboarding completed successfully',
            statusCode: 201,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'ONBOARDING_ERROR',
            message: err.message || 'Could not complete vendor onboarding.',
            details: err.details || [],
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * -----------------------------------------------------------
 * Admin Vendor Management Endpoints (Super Admin Protected)
 * -----------------------------------------------------------
 */

/**
 * GET /vendors
 * List all vendors
 */
router.get('/', authenticateUser, requireSuperAdmin, async (req, res) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = req.query.status.toUpperCase();
        if (req.query.onboardingStatus) filter.onboardingStatus = req.query.onboardingStatus.toUpperCase();

        const vendors = await vendorService.getVendors(filter);
        return sendSuccess(res, {
            data: vendors,
            message: 'Vendors retrieved successfully',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'INTERNAL_SERVER_ERROR',
            message: err.message,
            statusCode: 500,
            req
        });
    }
});

/**
 * POST /vendors
 * Super Admin creates/invites a new Vendor
 */
router.post('/', authenticateUser, requireSuperAdmin, async (req, res) => {
    try {
        const { name, companyName, email, mobile, address, gstNumber, drugLicenseNumber } = req.body;
        if (!name || !email) {
            return sendError(res, {
                code: 'VALIDATION_ERROR',
                message: 'Vendor name and email address are required.',
                details: [
                    ...(!name ? [{ field: 'name', code: 'REQUIRED', message: 'Name is required' }] : []),
                    ...(!email ? [{ field: 'email', code: 'REQUIRED', message: 'Email is required' }] : [])
                ],
                statusCode: 400,
                req
            });
        }

        const { vendor } = await vendorService.createVendor({
            name,
            companyName: companyName || name,
            email,
            mobile,
            address,
            gstNumber,
            drugLicenseNumber
        }, req.context || req.user);

        return sendSuccess(res, {
            data: {
                vendor: {
                    id: vendor._id || vendor.id,
                    name: vendor.name,
                    companyName: vendor.companyName,
                    email: vendor.email,
                    mobile: vendor.mobile || '',
                    status: vendor.status || 'INVITED',
                    onboardingStatus: vendor.onboardingStatus || 'PENDING',
                    invitedAt: vendor.createdAt ? new Date(vendor.createdAt).toISOString() : new Date().toISOString()
                },
                invitation: {
                    status: 'EMAIL_SENT'
                }
            },
            message: 'Vendor invitation created',
            statusCode: 201,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'VENDOR_CREATION_FAILED',
            message: err.message,
            details: err.details || [],
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * POST /vendors/:vendorId/onboarding/invite
 */
router.post('/:vendorId/onboarding/invite', authenticateUser, requireSuperAdmin, async (req, res) => {
    try {
        const result = await vendorService.resendOnboardingInvite(req.params.vendorId, req.context || req.user);
        return sendSuccess(res, {
            data: result,
            message: 'Vendor onboarding invitation sent',
            statusCode: 202,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'INVITE_ERROR',
            message: err.message,
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * POST /vendors/:vendorId/onboarding/resend
 */
router.post('/:vendorId/onboarding/resend', authenticateUser, requireSuperAdmin, async (req, res) => {
    try {
        const result = await vendorService.resendOnboardingInvite(req.params.vendorId, req.context || req.user);
        return sendSuccess(res, {
            data: {
                vendorId: req.params.vendorId,
                status: 'EMAIL_SENT',
                expiresAt: result.expiresAt
            },
            message: 'Onboarding invitation resent successfully',
            statusCode: 202,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: err.code || 'RESEND_ERROR',
            message: err.message,
            statusCode: err.status || 400,
            req
        });
    }
});

/**
 * GET /vendors/:vendorId/onboarding/status
 */
router.get('/:vendorId/onboarding/status', authenticateUser, requireSuperAdmin, async (req, res) => {
    try {
        const vendor = await vendorService.getVendorById(req.params.vendorId);
        if (!vendor) {
            return sendError(res, {
                code: 'VENDOR_NOT_FOUND',
                message: 'Vendor not found.',
                statusCode: 404,
                req
            });
        }

        let tenant = null;
        if (vendor.tenantId) {
            const t = await tenantService.getTenantById(vendor.tenantId);
            if (t) {
                tenant = {
                    id: t.id || t._id,
                    name: t.name,
                    status: t.status
                };
            }
        }

        return sendSuccess(res, {
            data: {
                vendor: {
                    id: vendor._id || vendor.id,
                    name: vendor.name,
                    email: vendor.email
                },
                onboarding: {
                    status: vendor.onboardingStatus,
                    invitedAt: vendor.createdAt ? new Date(vendor.createdAt).toISOString() : null,
                    expiresAt: vendor.onboardingTokenExpiresAt ? new Date(vendor.onboardingTokenExpiresAt).toISOString() : null,
                    completedAt: vendor.onboardingCompletedAt ? new Date(vendor.onboardingCompletedAt).toISOString() : null
                },
                tenant
            },
            message: 'Onboarding status retrieved',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'INTERNAL_SERVER_ERROR',
            message: err.message,
            statusCode: 500,
            req
        });
    }
});

export default router;
