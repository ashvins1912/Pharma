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
import TenantMembership from '../../models/TenantMembership.js';
import UserProfile from '../../models/UserProfile.js';
import Tenant from '../../models/Tenant.js';
import TenantBranch from '../../models/TenantBranch.js';
import { domainEvents } from '../../shared/events/DomainEvents.js';
import Vendor from '../../models/Vendor.js';
import AuditEvent from '../../models/AuditEvent.js';

const router = express.Router();

/**
 * GET /vendor/profile
 * Returns the authenticated tenant's persisted profile and its own personnel.
 * Tenant users are always scoped from their signed identity + active membership;
 * only platform administrators may select a tenant through X-Tenant-Id.
 */
router.get('/profile', authenticateUser, async (req, res) => {
    try {
        const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
        const platformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        const tenantId = platformAdmin
            ? String(req.get('x-tenant-id') || req.query.tenantId || req.user?.tenantId || req.user?.app_metadata?.tenantId || '').trim()
            : String(req.user?.tenantId || req.user?.app_metadata?.tenantId || '').trim();

        if (!tenantId) {
            return sendError(res, { code: 'TENANT_CONTEXT_REQUIRED', message: 'Select an authorized pharmacy tenant first.', statusCode: 403, req });
        }

        let membership = null;
        if (!platformAdmin) {
            membership = await TenantMembership.findOne({
                userId: String(req.user?.sub || req.user?.id || req.user?.userId || ''),
                tenantId,
                status: 'ACTIVE'
            }).lean();
            if (!membership) {
                return sendError(res, { code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active membership for this pharmacy is required.', statusCode: 403, req });
            }
        }
        const canViewPersonnel = platformAdmin
            || ['TENANT_OWNER', 'TENANT_ADMIN'].includes(String(membership?.role || '').toUpperCase());

        const tenant = await Tenant.findOne({ _id: tenantId, status: { $ne: 'DISABLED' } }).lean();
        if (!tenant) {
            return sendError(res, { code: 'TENANT_PROFILE_NOT_FOUND', message: 'The selected pharmacy profile was not found.', statusCode: 404, req });
        }

        const [vendor, personnel, memberships] = await Promise.all([
            Vendor.findOne({ tenantId }).sort({ onboardingCompletedAt: -1, updatedAt: -1 }).lean(),
            canViewPersonnel
                ? UserProfile.find({ tenantId, status: 'ACTIVE' })
                    .select('userId name firstName lastName email role roles')
                    .sort({ createdAt: 1 }).lean()
                : Promise.resolve([]),
            canViewPersonnel
                ? TenantMembership.find({ tenantId, status: { $in: ['ACTIVE', 'INVITED'] } })
                    .select('userId branchId role status').lean()
                : Promise.resolve([])
        ]);
        const membershipByUserId = new Map(memberships.map(item => [String(item.userId), item]));

        const address = tenant.address || vendor?.address || {};
        const owner = personnel.find(member => ['TENANT_OWNER', 'TENANT_ADMIN', 'OWNER'].includes(String(member.role || '').toUpperCase()))
            || personnel[0] || null;
        const ownerDetails = {
            name: owner?.name || [owner?.firstName, owner?.lastName].filter(Boolean).join(' '),
            email: owner?.email || tenant.contactEmail || vendor?.email || '',
            phone: tenant.contactPhone || vendor?.mobile || ''
        };
        return sendSuccess(res, {
            data: {
                profileConfigured: Boolean(tenant.name || tenant.legalName || tenant.drugLicenseNumber || tenant.contactEmail),
                tenant: {
                    id: String(tenant._id),
                    shopName: tenant.name || '',
                    legalName: tenant.legalName || '',
                    licenseNumber: tenant.drugLicenseNumber || '',
                    gstNumber: tenant.gstNumber || '',
                    geolocation: {
                        latitude: tenant.geolocation?.latitude ?? null,
                        longitude: tenant.geolocation?.longitude ?? null
                    },
                    usesTenantAsBranch: tenant.usesTenantAsBranch === true,
                    address: {
                        street: address.street || address.line1 || '',
                        city: address.city || '',
                        state: address.state || '',
                        zipCode: address.zipCode || address.pincode || ''
                    },
                    ownerDetails,
                    status: tenant.status || '',
                    slug: tenant.slug || '',
                    code: tenant.code || '',
                    timezone: tenant.timezone || '',
                    currency: tenant.currency || ''
                },
                personnel: personnel.map(member => {
                    const membership = membershipByUserId.get(String(member.userId));
                    return {
                        id: String(member.userId || member._id),
                        name: member.name || [member.firstName, member.lastName].filter(Boolean).join(' '),
                        email: member.email || '',
                        role: membership?.role || member.role || (member.roles || [])[0] || '',
                        branchId: membership?.branchId || null,
                        status: membership?.status || 'ACTIVE'
                    };
                })
            },
            message: 'Tenant profile retrieved successfully.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'TENANT_PROFILE_UNAVAILABLE',
            message: 'The pharmacy profile is temporarily unavailable.',
            statusCode: 503,
            req
        });
    }
});

/**
 * POST /vendor/profile/personnel
 * Assign an existing registered tenant user to a branch with a tenant-scoped role.
 * A tenant administrator cannot grant access to a different tenant.
 */
router.post('/profile/personnel', authenticateUser, async (req, res) => {
    try {
        const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
        const platformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        const tenantId = String(platformAdmin
            ? req.get('x-tenant-id') || req.body?.tenantId || ''
            : req.user?.tenantId || req.user?.app_metadata?.tenantId || '').trim();
        if (!tenantId) return sendError(res, { code: 'TENANT_CONTEXT_REQUIRED', message: 'Select a pharmacy tenant first.', statusCode: 400, req });

        let tenantMembership = null;
        if (!platformAdmin) {
            tenantMembership = await TenantMembership.findOne({
                userId: String(req.user?.sub || req.user?.id || ''),
                tenantId,
                status: 'ACTIVE'
            }).lean();
            if (!tenantMembership || !['TENANT_OWNER', 'TENANT_ADMIN'].includes(String(tenantMembership.role).toUpperCase()) || tenantMembership.branchId) {
                return sendError(res, { code: 'TENANT_ADMIN_REQUIRED', message: 'Only a tenant-wide owner or administrator can assign branch users.', statusCode: 403, req });
            }
        }

        const email = String(req.body?.email || '').trim().toLowerCase();
        const assignedRole = String(req.body?.role || '').trim().toUpperCase();
        const branchId = String(req.body?.branchId || '').trim() || null;
        const allowedRoles = new Set(['TENANT_ADMIN', 'PHARMACY_STAFF', 'PHARMACIST', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'DISPATCHER', 'RIDER', 'TENANT_RIDER']);
        if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || !allowedRoles.has(assignedRole) || (!branchId && assignedRole !== 'TENANT_ADMIN')) {
            return sendError(res, { code: 'INVALID_PERSONNEL_ASSIGNMENT', message: 'Provide a valid registered email and supported tenant role.', statusCode: 400, req });
        }
        if (branchId) {
            const branch = await TenantBranch.findOne({ _id: branchId, tenantId, status: 'ACTIVE' }).select('_id').lean();
            if (!branch) return sendError(res, { code: 'BRANCH_NOT_FOUND', message: 'Choose an active branch belonging to this pharmacy.', statusCode: 404, req });
        }

        const memberProfile = await UserProfile.findOne({ tenantId, email, status: 'ACTIVE' })
            .select('userId name firstName lastName email')
            .lean();
        if (!memberProfile?.userId) {
            return sendError(res, { code: 'REGISTERED_TENANT_USER_REQUIRED', message: 'This email must belong to an active registered user of this pharmacy before role assignment.', statusCode: 404, req });
        }

        const membership = await TenantMembership.findOneAndUpdate(
            { userId: String(memberProfile.userId), tenantId },
            { $set: { branchId, role: assignedRole, status: 'ACTIVE', invitedBy: String(req.user?.sub || req.user?.id || 'platform') } },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        ).lean();
        domainEvents.emitDomainEvent('TENANT_MEMBER_ASSIGNED', String(memberProfile.userId), {
            email, role: assignedRole, branchId
        }, req.user, tenantId, branchId);

        return sendSuccess(res, {
            data: {
                id: String(memberProfile.userId),
                name: memberProfile.name || [memberProfile.firstName, memberProfile.lastName].filter(Boolean).join(' '),
                email,
                role: membership.role,
                branchId: membership.branchId || null,
                status: membership.status
            },
            message: 'User role and branch access updated.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'TENANT_MEMBER_ASSIGNMENT_FAILED',
            message: err.message || 'Could not assign this user to the selected branch.',
            statusCode: err.code === 11000 ? 409 : 500,
            req
        });
    }
});

/**
 * GET /vendor/profile/activity
 * Returns durable, tenant-scoped audit events; branch members only see their branch.
 */
router.get('/profile/activity', authenticateUser, async (req, res) => {
    try {
        const role = String(req.user?.app_metadata?.role || req.user?.role || '').toUpperCase();
        const platformAdmin = ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(role);
        const tenantId = String(platformAdmin
            ? req.get('x-tenant-id') || req.query.tenantId || ''
            : req.user?.tenantId || req.user?.app_metadata?.tenantId || '').trim();
        if (!tenantId) return sendError(res, { code: 'TENANT_CONTEXT_REQUIRED', message: 'Select a pharmacy tenant first.', statusCode: 400, req });

        let membership = null;
        if (!platformAdmin) {
            membership = await TenantMembership.findOne({
                userId: String(req.user?.sub || req.user?.id || ''),
                tenantId,
                status: 'ACTIVE'
            }).select('role branchId').lean();
            if (!membership) return sendError(res, { code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active pharmacy membership is required.', statusCode: 403, req });
        }

        const filter = { tenantId };
        if (!platformAdmin && membership?.branchId) filter.branchId = membership.branchId;
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const events = await AuditEvent.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
        return sendSuccess(res, {
            data: { events },
            message: 'Tenant activity retrieved.',
            statusCode: 200,
            req
        });
    } catch (err) {
        return sendError(res, {
            code: 'TENANT_ACTIVITY_UNAVAILABLE',
            message: 'Tenant activity is temporarily unavailable.',
            statusCode: 503,
            req
        });
    }
});

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
