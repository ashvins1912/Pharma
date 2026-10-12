/**
 * Platform Super Admin Tenant Management Routes (/api/v1/admin/tenants)
 * Strictly restricted to platform Super Administrators.
 */
import express from 'express';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import { tenantService } from '../../services/tenant-service/TenantService.js';
import { emailService } from '../../services/notification-service/EmailService.js';
import { supabase } from '../../config/supabase.js';

const router = express.Router();

// Enforce authentication & Platform Super Admin role across all endpoints in this router
router.use(authenticateUser, requireSuperAdmin);

/**
 * GET /api/v1/admin/tenants/smtp/config
 * Retrieve global platform SMTP configuration
 */
router.get('/smtp/config', async (_req, res, next) => {
    try {
        const config = emailService.getGlobalSmtpConfig();
        res.json({
            success: true,
            data: config
        });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/v1/admin/tenants/smtp/config
 * Update global platform SMTP configuration
 */
router.put('/smtp/config', async (req, res, next) => {
    try {
        const { host, port, secure, user, pass, from, service, enabled } = req.body;
        const updated = emailService.setGlobalSmtpConfig({
            host,
            port,
            secure,
            user,
            pass,
            from,
            service,
            enabled
        });
        res.json({
            success: true,
            data: updated,
            message: 'Global SMTP configuration updated successfully.'
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants/smtp/test
 * Test SMTP connection and dispatch verification test email
 */
router.post('/smtp/test', async (req, res, next) => {
    try {
        const { targetEmail, host, port, secure, user, pass, from } = req.body;
        if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail.trim())) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_INPUT', message: 'A valid target email address is required for SMTP diagnostic test.' }
            });
        }

        const customConfig = (host || user || pass) ? { host, port, secure, user, pass, from } : null;
        const testResult = await emailService.sendTestEmail(targetEmail.trim(), customConfig);

        res.json({
            success: true,
            data: testResult,
            message: testResult.simulated
                ? `SMTP test completed in simulated mode for ${targetEmail.trim()}.`
                : `Test email dispatched successfully to ${targetEmail.trim()}.`
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/v1/admin/tenants/smtp/history
 * Retrieve recent email dispatch history & audit logs
 */
router.get('/smtp/history', async (req, res, next) => {
    try {
        const tenantId = req.query.tenantId || null;
        const limit = req.query.limit ? Number(req.query.limit) : 50;
        const history = emailService.getDispatchHistory({ tenantId, limit });
        res.json({
            success: true,
            data: history,
            count: history.length
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/v1/admin/tenants
 * List all tenants on the platform with optional status filter
 */
router.get('/', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.status) {
            filter.status = req.query.status.toUpperCase();
        }
        const tenants = await tenantService.getTenants(filter);
        res.json({
            success: true,
            data: tenants,
            count: tenants.length
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants
 * Onboard a new pharmacy tenant and trigger onboarding email
 */
router.post('/', async (req, res, next) => {
    try {
        const {
            name,
            slug,
            legalName,
            contactEmail,
            contactPhone,
            timezone,
            currency,
            settings,
            initialAdminEmail,
            initialAdminName,
            smtpConfig
        } = req.body;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_INPUT', message: 'Tenant name is required.' }
            });
        }

        const mergedSettings = {
            ...(settings || {})
        };
        if (smtpConfig && typeof smtpConfig === 'object') {
            mergedSettings.smtp = smtpConfig;
        }

        const newTenant = await tenantService.createTenant({
            name,
            slug,
            legalName,
            contactEmail,
            contactPhone,
            timezone,
            currency,
            settings: mergedSettings
        }, req.context);

        // Invite initial administrator if specified
        let initialAdmin = null;
        if (initialAdminEmail && typeof initialAdminEmail === 'string' && initialAdminEmail.trim()) {
            try {
                initialAdmin = await tenantService.inviteTenantAdmin(newTenant.id, {
                    email: initialAdminEmail.trim().toLowerCase(),
                    name: initialAdminName || `${newTenant.name} Administrator`
                }, req.context);
            } catch (inviteErr) {
                console.warn('Initial tenant administrator invitation warning:', inviteErr.message);
            }
        }

        // Trigger comprehensive onboarding email
        let emailNotification = null;
        try {
            const emailResult = await emailService.sendTenantOnboardingEmail(newTenant, initialAdmin, {
                smtpConfig: smtpConfig || mergedSettings.smtp
            });
            emailNotification = {
                dispatched: emailResult.success,
                simulated: Boolean(emailResult.simulated),
                status: emailResult.status,
                recipient: emailResult.recipient,
                messageId: emailResult.messageId,
                smtpHost: emailResult.smtpHost,
                smtpPort: emailResult.smtpPort,
                error: emailResult.error || null
            };
        } catch (emailErr) {
            console.warn('Tenant onboarding email warning:', emailErr.message);
            emailNotification = {
                dispatched: false,
                status: 'FAILED',
                error: emailErr.message
            };
        }

        res.status(201).json({
            success: true,
            data: newTenant,
            initialAdmin,
            emailNotification,
            message: `Tenant "${newTenant.name}" onboarded successfully.`
        });
    } catch (err) {
        if (err.message?.includes('already in use')) {
            return res.status(409).json({
                success: false,
                error: { code: 'SLUG_CONFLICT', message: err.message }
            });
        }
        next(err);
    }
});

/**
 * GET /api/v1/admin/tenants/:tenantId
 * Retrieve detailed tenant information and branch listings
 */
router.get('/:tenantId', async (req, res, next) => {
    try {
        const tenant = await tenantService.getTenantById(req.params.tenantId);
        if (!tenant) {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }

        const branches = await tenantService.getBranches(tenant.id);
        const memberships = await tenantService.getMembershipsForTenant(tenant.id);

        res.json({
            success: true,
            data: {
                ...tenant,
                branches,
                memberships
            }
        });
    } catch (err) {
        next(err);
    }
});

/**
 * PATCH /api/v1/admin/tenants/:tenantId
 * Update tenant profile or settings
 */
router.patch('/:tenantId', async (req, res, next) => {
    try {
        const updated = await tenantService.updateTenant(req.params.tenantId, req.body, req.context);
        res.json({
            success: true,
            data: updated,
            message: 'Tenant updated successfully.'
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        if (err.message?.includes('already in use')) {
            return res.status(409).json({
                success: false,
                error: { code: 'SLUG_CONFLICT', message: err.message }
            });
        }
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants/:tenantId/suspend
 * Suspend tenant access across all services
 */
router.post('/:tenantId/suspend', async (req, res, next) => {
    try {
        const suspended = await tenantService.suspendTenant(req.params.tenantId, req.context);
        res.json({
            success: true,
            data: suspended,
            message: `Tenant "${suspended.name}" has been suspended.`
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants/:tenantId/activate
 * Re-activate a previously suspended tenant
 */
router.post('/:tenantId/activate', async (req, res, next) => {
    try {
        const activated = await tenantService.activateTenant(req.params.tenantId, req.context);
        res.json({
            success: true,
            data: activated,
            message: `Tenant "${activated.name}" is now active.`
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        next(err);
    }
});

/**
 * POST /api/v1/admin/tenants/:tenantId/invite-admin
 * Invite or onboard a tenant administrator
 */
router.post('/:tenantId/invite-admin', async (req, res, next) => {
    try {
        const { email, name, branchId, permissions } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_EMAIL', message: 'A valid administrator email is required.' }
            });
        }

        const invite = await tenantService.inviteTenantAdmin(req.params.tenantId, {
            email: email.trim().toLowerCase(),
            name,
            branchId,
            permissions
        }, req.context);

        // If Supabase service role is present, update user's app_metadata if user already exists
        if (supabase?.auth?.admin) {
            try {
                const { data: usersData } = await supabase.auth.admin.listUsers();
                const existingUser = usersData?.users?.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
                if (existingUser) {
                    await supabase.auth.admin.updateUserById(existingUser.id, {
                        app_metadata: {
                            ...existingUser.app_metadata,
                            role: 'TENANT_ADMIN',
                            tenantId: req.params.tenantId
                        }
                    });
                }
            } catch (supaErr) {
                console.warn('Could not auto-sync Supabase user metadata during tenant admin invite:', supaErr.message);
            }
        }

        // Trigger administrator invitation email
        let emailNotification = null;
        try {
            const tenant = await tenantService.getTenantById(req.params.tenantId);
            const emailResult = await emailService.sendTenantAdminInvitationEmail(tenant, invite);
            emailNotification = {
                dispatched: emailResult.success,
                simulated: Boolean(emailResult.simulated),
                status: emailResult.status,
                recipient: emailResult.recipient,
                messageId: emailResult.messageId
            };
        } catch (emailErr) {
            console.warn('Admin invite email dispatch warning:', emailErr.message);
            emailNotification = {
                dispatched: false,
                status: 'FAILED',
                error: emailErr.message
            };
        }

        res.status(201).json({
            success: true,
            data: invite,
            emailNotification,
            message: `Tenant admin invitation issued to ${email.trim()}.`
        });
    } catch (err) {
        if (err.message === 'Tenant not found') {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        next(err);
    }
});

/**
 * GET /api/v1/admin/tenants/:tenantId/smtp
 * Get tenant-specific SMTP configuration
 */
router.get('/:tenantId/smtp', async (req, res, next) => {
    try {
        const tenant = await tenantService.getTenantById(req.params.tenantId);
        if (!tenant) {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }
        const effectiveConfig = emailService.resolveConfig(tenant);
        res.json({
            success: true,
            data: {
                tenantId: tenant.id,
                tenantName: tenant.name,
                hasCustomSmtp: Boolean(tenant.settings?.smtp?.enabled),
                config: {
                    host: effectiveConfig.host,
                    port: effectiveConfig.port,
                    secure: effectiveConfig.secure,
                    encryption: effectiveConfig.secure ? 'SSL' : 'STARTTLS',
                    user: effectiveConfig.user,
                    pass: effectiveConfig.pass ? '••••••••••••••••' : '',
                    hasPassword: Boolean(effectiveConfig.pass),
                    from: effectiveConfig.from,
                    enabled: effectiveConfig.enabled
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/v1/admin/tenants/:tenantId/smtp
 * Configure tenant-specific SMTP settings
 */
router.put('/:tenantId/smtp', async (req, res, next) => {
    try {
        const tenant = await tenantService.getTenantById(req.params.tenantId);
        if (!tenant) {
            return res.status(404).json({
                success: false,
                error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found.' }
            });
        }

        const { host, port, secure, user, pass, from, enabled } = req.body;
        const currentSmtp = tenant.settings?.smtp || {};

        const newSmtp = {
            host: host !== undefined ? host.trim() : currentSmtp.host,
            port: port !== undefined ? Number(port) : currentSmtp.port,
            secure: secure !== undefined ? Boolean(secure) : currentSmtp.secure,
            user: user !== undefined ? user.trim() : currentSmtp.user,
            pass: pass !== undefined && pass !== '••••••••••••••••' ? pass.trim() : currentSmtp.pass,
            from: from !== undefined ? from.trim() : currentSmtp.from,
            enabled: enabled !== undefined ? Boolean(enabled) : true
        };

        const updatedTenant = await tenantService.updateTenant(req.params.tenantId, {
            settings: {
                ...tenant.settings,
                smtp: newSmtp
            }
        }, req.context);

        res.json({
            success: true,
            data: {
                tenantId: updatedTenant.id,
                smtp: {
                    ...newSmtp,
                    pass: newSmtp.pass ? '••••••••••••••••' : ''
                }
            },
            message: `SMTP configuration updated for ${tenant.name}.`
        });
    } catch (err) {
        next(err);
    }
});

export default router;
