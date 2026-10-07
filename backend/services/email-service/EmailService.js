/**
 * Centralized Email Service for Ashvin Pharmacy Platform
 * Handles SMTP dispatch for account verification, vendor onboarding, and password resets.
 */
import nodemailer from 'nodemailer';
import { logger } from '../../shared/observability/logger.js';

class EmailService {
    constructor() {
        this.host = process.env.SMTP_HOST || 'smtp.gmail.com';
        this.port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
        this.secure = process.env.SMTP_SECURE === 'true' || this.port === 465;
        this.user = process.env.SMTP_USER || '';
        this.pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
        this.from = process.env.SMTP_FROM || (this.user ? `"Ashvin Pharmacy" <${this.user}>` : '');

        this.transporter = null;
        this._initTransporter();
    }

    _initTransporter() {
        if (this.pass && this.pass.trim()) {
            try {
                this.transporter = nodemailer.createTransport({
                    host: this.host,
                    port: this.port,
                    secure: this.secure,
                    auth: {
                        user: this.user,
                        pass: this.pass.trim()
                    }
                });
                logger.info('SMTP EmailService transporter initialized', { host: this.host, port: this.port, user: this.user });
            } catch (err) {
                logger.warn('Failed to initialize nodemailer SMTP transport', { error: err.message });
                this.transporter = null;
            }
        } else {
            logger.info('EmailService running in simulated mode (SMTP_PASSWORD not configured). Outgoing emails will be logged.');
        }
    }

    /**
     * Send email verification link to newly registered user
     */
    async sendEmailVerification({ email, name, token, code, verificationUrl }) {
        const targetUrl = verificationUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${encodeURIComponent(token)}`;
        const recipientName = name || 'Valued Member';

        const subject = 'Verify your Ashvin Pharmacy account';
        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .brand { font-size: 22px; font-weight: 800; color: #0d9488; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }
    h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
    p { font-size: 14px; line-height: 1.6; color: #475569; margin: 12px 0; }
    .btn { display: inline-block; background-color: #0d9488; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; margin: 24px 0; text-align: center; }
    .link-box { word-break: break-all; background-color: #f1f5f9; padding: 12px 16px; border-radius: 8px; font-size: 12px; color: #64748b; font-family: monospace; margin: 16px 0; }
    .footer { border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; }
    .badge { display: inline-block; background-color: #ccfbf1; color: #0f766e; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">💊 Ashvin Pharmacy Platform</div>
    <span class="badge">Account Verification</span>
    <h1>Welcome, ${recipientName}!</h1>
    <p>Thank you for signing up for Ashvin Pharmacy. Confirm your email address using the verification code below before continuing to your profile setup.</p>
    ${code ? `<div style="text-align:center; margin:24px 0;"><div style="font-size:12px; color:#64748b; margin-bottom:8px; font-weight:700; text-transform:uppercase; letter-spacing:1px;">Your 6-digit verification code</div><div style="display:inline-block; padding:16px 24px; background:#f0fdfa; border:1px solid #99f6e4; border-radius:14px; font-size:32px; letter-spacing:8px; font-weight:900; color:#0f766e; font-family:monospace;">${code}</div></div>` : ''}
    <div style="text-align: center;">
      <a href="${targetUrl}" class="btn" target="_blank">Verify Email Address</a>
    </div>
    <p>Your 6-digit code is valid for <strong>10 minutes</strong>. You can also use the verification link below while it remains available:</p>
    <div class="link-box">${targetUrl}</div>
    <p style="font-size: 12px; color: #64748b;">If you did not request this account, please ignore this email.</p>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Ashvin Healthcare Private Limited. All rights reserved.
    </div>
  </div>
</body>
</html>
        `;

        return this._dispatchEmail({
            to: email,
            subject,
            html,
            eventType: 'EMAIL_VERIFICATION_SENT',
            meta: { email, targetUrl }
        });
    }

    /**
     * Send vendor onboarding invitation email
     */
    async sendVendorOnboardingEmail({ vendor, token, onboardingUrl }) {
        const targetUrl = onboardingUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/vendor-onboarding?token=${encodeURIComponent(token)}`;
        const vendorName = vendor.name || 'Pharmacy Partner';
        const companyName = vendor.companyName || 'Your Pharmacy';

        const subject = `Complete your Vendor Onboarding - ${companyName}`;
        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .brand { font-size: 22px; font-weight: 800; color: #4f46e5; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
    p { font-size: 14px; line-height: 1.6; color: #475569; margin: 12px 0; }
    .btn { display: inline-block; background-color: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; margin: 24px 0; text-align: center; }
    .details { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin: 16px 0; }
    .details-row { display: flex; justify-content: space-between; font-size: 13px; margin: 6px 0; }
    .details-label { color: #64748b; font-weight: 600; }
    .details-value { color: #0f172a; font-weight: 700; }
    .link-box { word-break: break-all; background-color: #f1f5f9; padding: 12px 16px; border-radius: 8px; font-size: 12px; color: #64748b; font-family: monospace; margin: 16px 0; }
    .footer { border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; }
    .badge { display: inline-block; background-color: #e0e7ff; color: #3730a3; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">🌐 Ashvin Pharmacy Multi-Tenant Platform</div>
    <span class="badge">Vendor Onboarding Invitation</span>
    <h1>Welcome to the Platform, ${vendorName}!</h1>
    <p>You have been invited to onboard <strong>${companyName}</strong> onto the Ashvin Pharmacy Multi-Tenant Platform as an authorized partner pharmacy vendor.</p>
    
    <div class="details">
      <div class="details-row"><span class="details-label">Company Name:</span><span class="details-value">${companyName}</span></div>
      <div class="details-row"><span class="details-label">Primary Email:</span><span class="details-value">${vendor.email}</span></div>
      ${vendor.mobile ? `<div class="details-row"><span class="details-label">Contact Phone:</span><span class="details-value">${vendor.mobile}</span></div>` : ''}
    </div>

    <p>Click the secure link below to review pre-filled pharmacy records, configure your branch parameters, and create your Tenant Administrator credentials:</p>
    
    <div style="text-align: center;">
      <a href="${targetUrl}" class="btn" target="_blank">Complete Vendor Onboarding</a>
    </div>

    <p>This invitation link is single-use and will expire in <strong>48 hours</strong>.</p>
    <div class="link-box">${targetUrl}</div>

    <div class="footer">
      Ashvin Pharmacy Multi-Tenant Architecture &bull; Need assistance? Contact <a href="mailto:care@ashvinpharmacy.com">care@ashvinpharmacy.com</a>
    </div>
  </div>
</body>
</html>
        `;

        return this._dispatchEmail({
            to: vendor.email,
            subject,
            html,
            eventType: 'VENDOR_ONBOARDING_INVITE_SENT',
            meta: { email: vendor.email, companyName, targetUrl }
        });
    }

    /**
     * Send password reset email
     */
    async sendPasswordResetEmail({ email, name, token, resetUrl }) {
        const targetUrl = resetUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${encodeURIComponent(token)}`;
        const recipientName = name || 'User';

        const subject = 'Reset your password - Ashvin Pharmacy';
        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 36px 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .brand { font-size: 22px; font-weight: 800; color: #0d9488; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0; }
    p { font-size: 14px; line-height: 1.6; color: #475569; margin: 12px 0; }
    .btn { display: inline-block; background-color: #e11d48; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 700; font-size: 14px; margin: 24px 0; text-align: center; }
    .link-box { word-break: break-all; background-color: #f1f5f9; padding: 12px 16px; border-radius: 8px; font-size: 12px; color: #64748b; font-family: monospace; margin: 16px 0; }
    .footer { border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 20px; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">💊 Ashvin Pharmacy Platform</div>
    <h1>Password Reset Request</h1>
    <p>Hello ${recipientName},</p>
    <p>We received a request to reset the password for your Ashvin Pharmacy account. Click the button below to choose a new secure password:</p>
    <div style="text-align: center;">
      <a href="${targetUrl}" class="btn" target="_blank">Reset Password</a>
    </div>
    <p>This password reset link expires in <strong>1 hour</strong>. If you did not initiate this request, you can safely ignore this email.</p>
    <div class="link-box">${targetUrl}</div>
    <div class="footer">&copy; ${new Date().getFullYear()} Ashvin Healthcare Private Limited.</div>
  </div>
</body>
</html>
        `;

        return this._dispatchEmail({
            to: email,
            subject,
            html,
            eventType: 'PASSWORD_RESET_SENT',
            meta: { email, targetUrl }
        });
    }

    /**
     * Internal email dispatch handler with simulation fallback
     */
    async _dispatchEmail({ to, subject, html, eventType, meta }) {
        if (!this.transporter) {
            logger.info(`[EmailService:Simulated] ${eventType}`, {
                to,
                subject,
                meta
            });
            return {
                success: true,
                simulated: true,
                to,
                subject
            };
        }

        try {
            const info = await this.transporter.sendMail({
                from: this.from,
                to,
                subject,
                html
            });

            logger.info(`[EmailService] ${eventType}`, {
                messageId: info.messageId,
                to,
                response: info.response
            });

            return {
                success: true,
                messageId: info.messageId,
                to
            };
        } catch (error) {
            logger.error(`[EmailService:Error] Failed to send email for ${eventType}`, {
                to,
                error: error.message
            });
            // Critical: Do not crash callers on transient email transport failure
            return {
                success: false,
                error: error.message,
                to
            };
        }
    }
}

export const emailService = new EmailService();
export default emailService;
