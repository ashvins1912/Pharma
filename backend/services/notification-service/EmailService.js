/**
 * Generic & Configurable SMTP Email Service
 * Supports platform-level and per-tenant SMTP configurations (e.g. Gmail, Outlook, AWS SES, custom SMTP)
 * Features auto-detection of SSL (port 465) / STARTTLS (port 587), fallback simulation,
 * rich responsive onboarding templates, and full audit dispatch logs.
 */
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../shared/observability/logger.js';

export class EmailService {
    constructor() {
        this.globalSmtpConfig = {
            host: env.SMTP_HOST || 'smtp.gmail.com',
            port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
            secure: env.SMTP_SECURE != null
                ? env.SMTP_SECURE === 'true'
                : (Number(env.SMTP_PORT) === 465),
            user: env.SMTP_USER || '',
            pass: env.SMTP_PASS || '',
            from: env.SMTP_FROM || (env.SMTP_USER ? `Ashvin Pharmacy Platform <${env.SMTP_USER}>` : 'Ashvin Pharmacy Platform <no-reply@ashvinpharmacy.com>'),
            service: env.SMTP_SERVICE || undefined,
            enabled: true
        };

        this.dispatchHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * Get current global SMTP configuration with password optionally masked
     */
    getGlobalSmtpConfig({ maskPassword = true } = {}) {
        return {
            host: this.globalSmtpConfig.host,
            port: this.globalSmtpConfig.port,
            secure: this.globalSmtpConfig.secure,
            encryption: this.globalSmtpConfig.secure ? 'SSL' : 'STARTTLS',
            user: this.globalSmtpConfig.user,
            pass: maskPassword && this.globalSmtpConfig.pass
                ? '••••••••••••••••'
                : this.globalSmtpConfig.pass,
            hasPassword: Boolean(this.globalSmtpConfig.pass),
            from: this.globalSmtpConfig.from,
            service: this.globalSmtpConfig.service,
            enabled: this.globalSmtpConfig.enabled
        };
    }

    /**
     * Update global SMTP configuration dynamically
     */
    setGlobalSmtpConfig(newConfig = {}) {
        const port = newConfig.port != null ? Number(newConfig.port) : this.globalSmtpConfig.port;
        const secure = newConfig.secure != null
            ? Boolean(newConfig.secure)
            : (port === 465);

        this.globalSmtpConfig = {
            ...this.globalSmtpConfig,
            host: newConfig.host?.trim() || this.globalSmtpConfig.host,
            port,
            secure,
            user: newConfig.user !== undefined ? newConfig.user.trim() : this.globalSmtpConfig.user,
            pass: newConfig.pass !== undefined && newConfig.pass !== '••••••••••••••••'
                ? newConfig.pass.trim()
                : this.globalSmtpConfig.pass,
            from: newConfig.from?.trim() || this.globalSmtpConfig.from,
            service: newConfig.service?.trim() || this.globalSmtpConfig.service,
            enabled: newConfig.enabled !== undefined ? Boolean(newConfig.enabled) : this.globalSmtpConfig.enabled
        };

        logger.info('Global SMTP configuration updated', {
            host: this.globalSmtpConfig.host,
            port: this.globalSmtpConfig.port,
            secure: this.globalSmtpConfig.secure,
            user: this.globalSmtpConfig.user ? '***' : '(empty)'
        });

        return this.getGlobalSmtpConfig();
    }

    /**
     * Resolve effective SMTP configuration for a given tenant (per-tenant override or global fallback)
     */
    resolveConfig(tenant = null, overrideConfig = null) {
        const tenantSmtp = tenant?.settings?.smtp;
        const tenantConfig = (tenantSmtp && (tenantSmtp.enabled !== false || tenantSmtp.user || tenantSmtp.host))
            ? tenantSmtp
            : {};
        const overrides = overrideConfig || {};

        const effective = {
            ...this.globalSmtpConfig,
            ...tenantConfig,
            ...overrides
        };

        const port = Number(effective.port) || 587;
        let secure;
        if (overrides.secure !== undefined) {
            secure = Boolean(overrides.secure);
        } else if (tenantConfig.secure !== undefined) {
            secure = Boolean(tenantConfig.secure);
        } else if (overrides.port !== undefined || tenantConfig.port !== undefined) {
            secure = (port === 465);
        } else {
            secure = this.globalSmtpConfig.secure != null
                ? Boolean(this.globalSmtpConfig.secure)
                : (port === 465);
        }

        return {
            host: effective.host || 'smtp.gmail.com',
            port,
            secure,
            user: effective.user || '',
            pass: effective.pass || '',
            from: effective.from || (effective.user ? `Ashvin Pharmacy Platform <${effective.user}>` : 'Ashvin Pharmacy Platform <no-reply@ashvinpharmacy.com>'),
            service: effective.service || undefined,
            enabled: effective.enabled !== false
        };
    }

    /**
     * Create a configured Nodemailer transporter
     */
    createTransporter(config) {
        const transportOptions = {
            host: config.host,
            port: config.port,
            secure: config.secure, // true for 465, false for 587
            connectionTimeout: 8000,
            greetingTimeout: 5000,
            socketTimeout: 10000,
            tls: {
                rejectUnauthorized: process.env.NODE_ENV === 'production',
                ciphers: 'SSLv3'
            }
        };

        if (config.service) {
            transportOptions.service = config.service;
        }

        if (config.user && config.pass) {
            transportOptions.auth = {
                user: config.user,
                pass: config.pass
            };
        }

        return nodemailer.createTransport(transportOptions);
    }

    /**
     * Verify SMTP connectivity and credentials
     */
    async verifyConnection(customConfig = null) {
        const config = this.resolveConfig(null, customConfig);
        if (!config.user || !config.pass) {
            return {
                valid: false,
                simulated: true,
                message: 'SMTP credentials (username and app password) are not configured. Running in simulated delivery mode.'
            };
        }

        try {
            const transporter = this.createTransporter(config);
            await transporter.verify();
            return {
                valid: true,
                simulated: false,
                message: `Successfully connected to SMTP server ${config.host}:${config.port} (${config.secure ? 'SSL' : 'STARTTLS'}).`
            };
        } catch (err) {
            return {
                valid: false,
                simulated: false,
                error: err.message,
                message: `Failed to connect to SMTP server ${config.host}:${config.port}: ${err.message}`
            };
        }
    }

    /**
     * Record an email in the dispatch audit history
     */
    _recordDispatch(record) {
        this.dispatchHistory.unshift({
            id: `email-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            ...record
        });
        if (this.dispatchHistory.length > this.maxHistorySize) {
            this.dispatchHistory.pop();
        }
    }

    /**
     * Send email with resilient delivery (real SMTP if configured, simulated fallback if offline/mock)
     */
    async sendEmail({
        to,
        subject,
        html,
        text,
        tenant = null,
        smtpConfig = null,
        metadata = {}
    }) {
        if (!to) {
            throw new Error('Recipient email address (to) is required.');
        }

        const config = this.resolveConfig(tenant, smtpConfig);
        const from = config.from;
        const messageId = `<${Date.now()}.${crypto.randomBytes(4).toString('hex')}@ashvinpharmacy.com>`;

        // If credentials are provided, attempt real SMTP transmission
        if (config.enabled && config.user && config.pass) {
            try {
                const transporter = this.createTransporter(config);
                const info = await transporter.sendMail({
                    from,
                    to,
                    subject,
                    text,
                    html,
                    messageId
                });

                const record = {
                    status: 'SENT',
                    recipient: to,
                    subject,
                    from,
                    messageId: info.messageId || messageId,
                    smtpHost: config.host,
                    smtpPort: config.port,
                    tenantId: tenant?.id || metadata.tenantId || null,
                    metadata
                };
                this._recordDispatch(record);
                logger.info(`Email dispatched successfully to ${to} via SMTP ${config.host}:${config.port}`, {
                    recipient: to,
                    subject,
                    messageId: record.messageId
                });
                return { success: true, ...record };
            } catch (err) {
                logger.warn(`SMTP delivery error to ${to} (${config.host}:${config.port}): ${err.message}. Recording as SIMULATED fallback.`);
                const record = {
                    status: 'SIMULATED',
                    recipient: to,
                    subject,
                    from,
                    messageId,
                    smtpHost: config.host,
                    smtpPort: config.port,
                    tenantId: tenant?.id || metadata.tenantId || null,
                    error: err.message,
                    preview: text?.slice(0, 300) || html?.slice(0, 300),
                    metadata
                };
                this._recordDispatch(record);
                return { success: true, simulated: true, ...record };
            }
        }

        // Simulated / development delivery mode (credentials not configured)
        const record = {
            status: 'SIMULATED',
            recipient: to,
            subject,
            from,
            messageId,
            smtpHost: config.host,
            smtpPort: config.port,
            tenantId: tenant?.id || metadata.tenantId || null,
            note: 'SMTP credentials unset or disabled; captured in simulated dispatch ledger.',
            preview: text?.slice(0, 300) || html?.slice(0, 300),
            metadata
        };
        this._recordDispatch(record);
        logger.info(`Email simulated for ${to}: "${subject}" (SMTP user not configured)`, { recipient: to, subject });
        return { success: true, simulated: true, ...record };
    }

    /**
     * Trigger comprehensive Onboarding Email for a newly onboarded Pharmacy Tenant
     */
    async sendTenantOnboardingEmail(tenant, initialAdmin = null, options = {}) {
        if (!tenant) throw new Error('Tenant data is required to send onboarding email.');

        const recipient = tenant.contactEmail || initialAdmin?.email;
        if (!recipient) {
            logger.warn(`Cannot send tenant onboarding email for ${tenant.name}: No contactEmail or initialAdminEmail found.`);
            return {
                success: false,
                skipped: true,
                message: 'No recipient email specified on tenant profile or initial administrator.'
            };
        }

        const config = this.resolveConfig(tenant, options.smtpConfig);
        const subject = `🏥 Welcome to Ashvin Pharmacy Platform: ${tenant.name} (${tenant.code || tenant.slug})`;
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: tenant.timezone || 'Asia/Kolkata' });

        const adminSectionHtml = initialAdmin ? `
            <div style="background-color: #f1f5f9; border-radius: 8px; padding: 18px; margin: 24px 0; border-left: 4px solid #0284c7;">
                <h3 style="margin-top: 0; margin-bottom: 8px; color: #0f172a; font-size: 16px;">🔑 Primary Administrator Access</h3>
                <p style="margin: 4px 0; color: #334155; font-size: 14px;"><strong>Admin Email:</strong> ${initialAdmin.email}</p>
                <p style="margin: 4px 0; color: #334155; font-size: 14px;"><strong>Role Scope:</strong> TENANT_ADMIN (Pharmacy Branch & Inventory Manager)</p>
                ${initialAdmin.invitationToken ? `
                <p style="margin: 4px 0; color: #334155; font-size: 14px;"><strong>Invitation Token:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${initialAdmin.invitationToken}</code></p>
                ` : ''}
                <div style="margin-top: 14px;">
                    <a href="${options.portalUrl || 'https://ashvinpharmacy.com/admin/login'}" style="display: inline-block; background-color: #0284c7; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">Log in to Pharmacy Dashboard</a>
                </div>
            </div>
        ` : '';

        const adminSectionText = initialAdmin ? `
PRIMARY ADMINISTRATOR ACCESS:
- Admin Email: ${initialAdmin.email}
- Assigned Role: TENANT_ADMIN (Branch & Inventory Manager)
${initialAdmin.invitationToken ? `- Invitation Token: ${initialAdmin.invitationToken}\n` : ''}
- Dashboard Login: ${options.portalUrl || 'https://ashvinpharmacy.com/admin/login'}
` : '';

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
    <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
        <!-- Platform Header -->
        <div style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 32px 28px; text-align: left; color: #ffffff;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.9; font-weight: 700; margin-bottom: 6px;">Ashvin Pharmacy Platform</div>
            <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">Tenant Onboarding Confirmation</h1>
            <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.95;">Official Welcome & Multi-Tenant Architecture Provisioning Record</p>
        </div>

        <!-- Body Content -->
        <div style="padding: 28px;">
            <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-top: 0;">
                Hello <strong>${tenant.name}</strong> Team,
            </p>
            <p style="font-size: 15px; line-height: 1.6; color: #334155;">
                We are pleased to confirm that your pharmacy tenant organization has been successfully provisioned onto the <strong>Ashvin Pharmacy Multi-Tenant Healthcare Platform</strong>.
            </p>

            <!-- Tenant Details Table -->
            <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <div style="background: #f8fafc; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #0f172a; font-size: 14px;">
                    📋 Onboarded Pharmacy Tenant Specifications
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; text-align: left;">
                    <tbody>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600; width: 38%;">Pharmacy Name</td>
                            <td style="padding: 10px 16px; color: #0f172a; font-weight: 700;">${tenant.name}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600;">Tenant Unique ID</td>
                            <td style="padding: 10px 16px; color: #0284c7; font-family: monospace; font-size: 13px;">${tenant.id}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600;">System Code / Slug</td>
                            <td style="padding: 10px 16px; color: #0f172a;"><span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-weight: 600;">${tenant.code || 'N/A'}</span> &bull; <code>${tenant.slug}</code></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600;">Legal Entity</td>
                            <td style="padding: 10px 16px; color: #0f172a;">${tenant.legalName || tenant.name}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600;">Primary Email</td>
                            <td style="padding: 10px 16px; color: #0f172a;">${tenant.contactEmail || 'Not specified'}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600;">Primary Contact Phone</td>
                            <td style="padding: 10px 16px; color: #0f172a;">${tenant.contactPhone || 'Not specified'}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600;">Operating Region</td>
                            <td style="padding: 10px 16px; color: #0f172a;">${tenant.timezone || 'Asia/Kolkata'} (${tenant.currency || 'INR'})</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px 16px; color: #64748b; font-weight: 600;">Onboarding Status</td>
                            <td style="padding: 10px 16px; color: #059669; font-weight: 700;">🟢 ${tenant.status || 'ACTIVE'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            ${adminSectionHtml}

            <!-- SMTP Details Box -->
            <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 14px 18px; margin: 20px 0; font-size: 12.5px; color: #475569;">
                <div style="font-weight: 700; margin-bottom: 4px; color: #1e293b;">📡 Delivery Service & SMTP Gateway Information:</div>
                <div>Triggered via: <strong>${config.host}:${config.port}</strong> (${config.secure ? 'SSL' : 'STARTTLS'})</div>
                <div>Sender Origin: <code>${config.from}</code></div>
                <div>Server Timestamp: <code>${timestamp}</code></div>
            </div>

            <!-- Footer Notes -->
            <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 0;">
                If you have questions regarding POS integrations, branch routing, or catalog imports, please reach out to our platform operations team at <a href="mailto:care@ashvinpharmacy.com" style="color: #0284c7;">care@ashvinpharmacy.com</a>.
            </p>
        </div>

        <div style="background: #f1f5f9; padding: 16px 28px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0;">
            &copy; ${new Date().getFullYear()} Ashvin Pharmacy Healthcare Systems. All rights reserved.
        </div>
    </div>
</body>
</html>
        `.trim();

        const text = `
=============================================================
ASHVIN PHARMACY PLATFORM - TENANT ONBOARDING CONFIRMATION
=============================================================

Hello ${tenant.name} Team,

Your pharmacy tenant organization has been successfully onboarded onto the Ashvin Pharmacy Multi-Tenant Healthcare Platform.

TENANT SPECIFICATIONS:
- Pharmacy Name: ${tenant.name}
- Tenant ID: ${tenant.id}
- Code / Slug: ${tenant.code || 'N/A'} / ${tenant.slug}
- Legal Name: ${tenant.legalName || tenant.name}
- Contact Email: ${tenant.contactEmail || 'Not specified'}
- Contact Phone: ${tenant.contactPhone || 'Not specified'}
- Operational Timezone: ${tenant.timezone || 'Asia/Kolkata'}
- Operating Currency: ${tenant.currency || 'INR'}
- Status: ${tenant.status || 'ACTIVE'}
- Onboarding Date: ${timestamp}
${adminSectionText}
DELIVERY CONFIGURATION:
- SMTP Server: ${config.host}:${config.port} (${config.secure ? 'SSL' : 'STARTTLS'})
- Sender: ${config.from}

For support, contact care@ashvinpharmacy.com.
=============================================================
        `.trim();

        return this.sendEmail({
            to: recipient,
            subject,
            html,
            text,
            tenant,
            smtpConfig: options.smtpConfig,
            metadata: {
                eventType: 'TENANT_ONBOARDED',
                tenantId: tenant.id,
                tenantName: tenant.name,
                adminEmail: initialAdmin?.email || null
            }
        });
    }

    /**
     * Send Administrator Invitation Email
     */
    async sendTenantAdminInvitationEmail(tenant, invite, options = {}) {
        if (!invite?.email) throw new Error('Administrator email is required.');
        const recipient = invite.email;
        const tenantName = tenant?.name || 'Pharmacy';
        const subject = `🔐 Administrator Invitation for ${tenantName}`;

        const html = `
<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background: #f8fafc; padding: 24px; color: #1e293b;">
    <div style="max-width: 580px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 24px; border: 1px solid #e2e8f0;">
        <h2 style="color: #0284c7; margin-top: 0;">Pharmacy Administrator Invitation</h2>
        <p>Hello <strong>${invite.name || 'Administrator'}</strong>,</p>
        <p>You have been invited to manage <strong>${tenantName}</strong> on the Ashvin Pharmacy Platform as a <strong>TENANT_ADMIN</strong>.</p>
        <div style="background: #f1f5f9; padding: 14px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Pharmacy Tenant:</strong> ${tenantName} (${tenant?.slug || 'HQ'})</p>
            <p style="margin: 4px 0;"><strong>Assigned Email:</strong> ${invite.email}</p>
            ${invite.invitationToken ? `<p style="margin: 4px 0;"><strong>Token:</strong> <code>${invite.invitationToken}</code></p>` : ''}
        </div>
        <p>Please log in or accept your invitation at the platform management portal.</p>
    </div>
</body>
</html>
        `.trim();

        const text = `
Hello ${invite.name || 'Administrator'},

You have been invited to manage ${tenantName} on the Ashvin Pharmacy Platform as a TENANT_ADMIN.
- Pharmacy: ${tenantName}
- Assigned Email: ${invite.email}
${invite.invitationToken ? `- Token: ${invite.invitationToken}\n` : ''}

Please log in to the management portal to accept.
        `.trim();

        return this.sendEmail({
            to: recipient,
            subject,
            html,
            text,
            tenant,
            metadata: {
                eventType: 'ADMIN_INVITED',
                tenantId: tenant?.id || null,
                adminEmail: invite.email
            }
        });
    }

    /**
     * Send test email for diagnostic verification of SMTP setup
     */
    async sendTestEmail(targetEmail, customConfig = null) {
        if (!targetEmail) throw new Error('Target test recipient email is required.');
        const config = this.resolveConfig(null, customConfig);
        const subject = `🧪 SMTP Diagnostic Test - Ashvin Pharmacy Platform`;
        const timestamp = new Date().toISOString();

        const html = `
<div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
    <h2 style="color: #059669;">✅ SMTP Configuration Verified</h2>
    <p>This is an automated diagnostic test from the <strong>Ashvin Pharmacy Platform</strong>.</p>
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>SMTP Server:</strong> ${config.host}:${config.port}</p>
        <p style="margin: 4px 0;"><strong>Encryption:</strong> ${config.secure ? 'SSL (Port 465)' : 'STARTTLS (Port 587)'}</p>
        <p style="margin: 4px 0;"><strong>Authenticated User:</strong> ${config.user || '(none)'}</p>
        <p style="margin: 4px 0;"><strong>Sender:</strong> ${config.from}</p>
        <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${timestamp}</p>
    </div>
</div>
        `.trim();

        return this.sendEmail({
            to: targetEmail,
            subject,
            html,
            text: `SMTP Diagnostic Test - Ashvin Pharmacy Platform.\nServer: ${config.host}:${config.port}\nTimestamp: ${timestamp}`,
            smtpConfig: customConfig,
            metadata: {
                eventType: 'DIAGNOSTIC_TEST'
            }
        });
    }

    /**
     * Retrieve dispatched email audit log
     */
    getDispatchHistory({ tenantId = null, limit = 50 } = {}) {
        let history = this.dispatchHistory;
        if (tenantId) {
            history = history.filter(h => h.tenantId === tenantId);
        }
        return history.slice(0, Math.min(limit, 100));
    }
}

export const emailService = new EmailService();
export default emailService;
