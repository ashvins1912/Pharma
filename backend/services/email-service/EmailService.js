/**
 * Centralized Email Service for Ashvin Pharmacy Platform
 * Handles SMTP dispatch for account verification, vendor onboarding, and password resets.
 */
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import UserProfile from '../../models/UserProfile.js';
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

    async resolveLanguage(email, explicitLanguage = null) {
        const explicit = String(explicitLanguage || '').toLowerCase();
        if (['en', 'hi', 'kn', 'bn', 'te'].includes(explicit)) return explicit;
        if (mongoose.connection.readyState !== 1 || !email) return 'en';
        try {
            const profile = await UserProfile.findOne({ email: String(email).toLowerCase().trim() }).select('preferredLanguage').lean();
            return ['en', 'hi', 'kn', 'bn', 'te'].includes(profile?.preferredLanguage) ? profile.preferredLanguage : 'en';
        } catch {
            return 'en';
        }
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
            logger.warn('SMTP email delivery is not configured; outgoing email cannot be delivered.', {
                environment: process.env.NODE_ENV || 'development',
                hasSmtpUser: Boolean(this.user),
                hasSmtpPassword: Boolean(this.pass)
            });
        }
    }

    /**
     * Send email verification link to newly registered user
     */
    async sendEmailVerification({ email, name, token, code, verificationUrl, language }) {
        const locale = await this.resolveLanguage(email, language);
        const copy = {
            en: { subject: 'Verify your QuickMeds Rx account', brand: 'QuickMeds Rx', badge: 'Account Verification', welcome: 'Welcome', intro: 'Thank you for signing up for QuickMeds Rx. Confirm your email address using the verification code below before continuing to your profile setup.', code: 'Your 6-digit verification code', verify: 'Verify Email Address', expires: 'Your 6-digit code is valid for', link: 'You can also use the verification link below while it remains available:', ignore: 'If you did not request this account, please ignore this email.', footer: '${copy.footer}' },
            hi: { subject: 'अपने QuickMeds Rx अकाउंट का ईमेल सत्यापित करें', brand: 'QuickMeds Rx', badge: 'अकाउंट सत्यापन', welcome: 'स्वागत है', intro: 'QuickMeds Rx पर साइन अप करने के लिए धन्यवाद। प्रोफ़ाइल सेटअप जारी रखने से पहले नीचे दिए गए कोड से अपना ईमेल सत्यापित करें।', code: 'आपका 6 अंकों का सत्यापन कोड', verify: 'ईमेल सत्यापित करें', expires: 'आपका 6 अंकों का कोड इस समय तक मान्य है', link: 'आप नीचे दिए गए सत्यापन लिंक का भी उपयोग कर सकते हैं:', ignore: 'यदि आपने यह अकाउंट नहीं बनाया है, तो इस ईमेल को अनदेखा करें।', footer: 'सर्वाधिकार सुरक्षित।' },
            kn: { subject: 'ನಿಮ್ಮ QuickMeds Rx ಖಾತೆಯ ಇಮೇಲ್ ಪರಿಶೀಲಿಸಿ', brand: 'QuickMeds Rx', badge: 'ಖಾತೆ ಪರಿಶೀಲನೆ', welcome: 'ಸ್ವಾಗತ', intro: 'QuickMeds Rx ಗೆ ಸೈನ್ ಅಪ್ ಮಾಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. ಪ್ರೊಫೈಲ್ ಸೆಟಪ್ ಮುಂದುವರಿಸುವ ಮೊದಲು ಕೆಳಗಿನ ಕೋಡ್ ಬಳಸಿ ಇಮೇಲ್ ಪರಿಶೀಲಿಸಿ.', code: 'ನಿಮ್ಮ 6 ಅಂಕಿಯ ಪರಿಶೀಲನಾ ಕೋಡ್', verify: 'ಇಮೇಲ್ ಪರಿಶೀಲಿಸಿ', expires: 'ನಿಮ್ಮ 6 ಅಂಕಿಯ ಕೋಡ್ ಈ ಅವಧಿಗೆ ಮಾನ್ಯ', link: 'ಲಭ್ಯವಿರುವವರೆಗೆ ಕೆಳಗಿನ ಪರಿಶೀಲನಾ ಲಿಂಕ್ ಬಳಸಿ:', ignore: 'ನೀವು ಈ ಖಾತೆಯನ್ನು ವಿನಂತಿಸದಿದ್ದರೆ ಈ ಇಮೇಲ್ ನಿರ್ಲಕ್ಷಿಸಿ.', footer: 'ಎಲ್ಲ ಹಕ್ಕುಗಳನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.' },
            bn: { subject: 'আপনার QuickMeds Rx অ্যাকাউন্টের ইমেল যাচাই করুন', brand: 'QuickMeds Rx', badge: 'অ্যাকাউন্ট যাচাইকরণ', welcome: 'স্বাগতম', intro: 'QuickMeds Rx-এ সাইন আপ করার জন্য ধন্যবাদ। প্রোফাইল সেটআপ চালিয়ে যাওয়ার আগে নিচের কোড দিয়ে আপনার ইমেল নিশ্চিত করুন।', code: 'আপনার ৬ সংখ্যার যাচাইকরণ কোড', verify: 'ইমেল যাচাই করুন', expires: 'আপনার ৬ সংখ্যার কোডের মেয়াদ', link: 'উপলভ্য থাকা পর্যন্ত নিচের যাচাইকরণ লিঙ্কটিও ব্যবহার করতে পারেন:', ignore: 'আপনি এই অ্যাকাউন্টের অনুরোধ না করলে এই ইমেল উপেক্ষা করুন।', footer: 'সর্বস্বত্ব সংরক্ষিত।' },
            te: { subject: 'మీ QuickMeds Rx ఖాతా ఇమెయిల్‌ను ధృవీకరించండి', brand: 'QuickMeds Rx', badge: 'ఖాతా ధృవీకరణ', welcome: 'స్వాగతం', intro: 'QuickMeds Rxలో సైన్ అప్ చేసినందుకు ధన్యవాదాలు. ప్రొఫైల్ సెటప్ కొనసాగించే ముందు దిగువ కోడ్‌తో మీ ఇమెయిల్‌ను నిర్ధారించండి.', code: 'మీ 6 అంకెల ధృవీకరణ కోడ్', verify: 'ఇమెయిల్ ధృవీకరించండి', expires: 'మీ 6 అంకెల కోడ్ చెల్లుబాటు సమయం', link: 'అందుబాటులో ఉన్నంత వరకు దిగువ ధృవీకరణ లింక్‌ను కూడా ఉపయోగించవచ్చు:', ignore: 'మీరు ఈ ఖాతాను అభ్యర్థించకపోతే ఈ ఇమెయిల్‌ను పట్టించుకోకండి.', footer: 'అన్ని హక్కులు ప్రత్యేకించబడ్డాయి.' }
        }[locale];
        const targetUrl = verificationUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${encodeURIComponent(token)}`;
        const recipientName = name || 'Valued Member';

        const subject = copy.subject;
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
    <div class="brand">💊 ${copy.brand}</div>
    <span class="badge">${copy.badge}</span>
    <h1>${copy.welcome}, ${recipientName}!</h1>
    <p>${copy.intro}</p>
    ${code ? `<div style="text-align:center; margin:24px 0;"><div style="font-size:12px; color:#64748b; margin-bottom:8px; font-weight:700; text-transform:uppercase; letter-spacing:1px;">${copy.code}</div><div style="display:inline-block; padding:16px 24px; background:#f0fdfa; border:1px solid #99f6e4; border-radius:14px; font-size:32px; letter-spacing:8px; font-weight:900; color:#0f766e; font-family:monospace;">${code}</div></div>` : ''}
    <div style="text-align: center;">
      <a href="${targetUrl}" class="btn" target="_blank">${copy.verify}</a>
    </div>
    <p>${copy.expires} <strong>10 minutes</strong>. ${copy.link}</p>
    <div class="link-box">${targetUrl}</div>
    <p style="font-size: 12px; color: #64748b;">${copy.ignore}</p>
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
    async sendPasswordResetEmail({ email, name, token, resetUrl, language }) {
        const locale = await this.resolveLanguage(email, language);
        const copy = {
            en: { subject: 'Reset your QuickMeds Rx password', brand: 'QuickMeds Rx', title: 'Password Reset Request', hello: 'Hello', intro: 'We received a request to reset the password for your QuickMeds Rx account. Click the button below to choose a new secure password:', button: 'Reset Password', expires: 'This password reset link expires in', ignore: 'If you did not initiate this request, you can safely ignore this email.' },
            hi: { subject: 'QuickMeds Rx पासवर्ड रीसेट करें', brand: 'QuickMeds Rx', title: 'पासवर्ड रीसेट अनुरोध', hello: 'नमस्ते', intro: 'हमें आपके QuickMeds Rx अकाउंट का पासवर्ड रीसेट करने का अनुरोध मिला है। नया सुरक्षित पासवर्ड चुनने के लिए नीचे दिए बटन पर क्लिक करें:', button: 'पासवर्ड रीसेट करें', expires: 'इस पासवर्ड रीसेट लिंक की समय-सीमा', ignore: 'यदि आपने यह अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा करें।' },
            kn: { subject: 'QuickMeds Rx ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸಿ', brand: 'QuickMeds Rx', title: 'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸುವ ವಿನಂತಿ', hello: 'ನಮಸ್ಕಾರ', intro: 'ನಿಮ್ಮ QuickMeds Rx ಖಾತೆಯ ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸಲು ವಿನಂತಿ ಬಂದಿದೆ. ಹೊಸ ಸುರಕ್ಷಿತ ಪಾಸ್‌ವರ್ಡ್ ಆಯ್ಕೆ ಮಾಡಲು ಕೆಳಗಿನ ಬಟನ್ ಕ್ಲಿಕ್ ಮಾಡಿ:', button: 'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸಿ', expires: 'ಈ ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸುವ ಲಿಂಕ್‌ನ ಅವಧಿ', ignore: 'ನೀವು ಈ ವಿನಂತಿ ಮಾಡದಿದ್ದರೆ ಈ ಇಮೇಲ್ ನಿರ್ಲಕ್ಷಿಸಿ.' },
            bn: { subject: 'QuickMeds Rx পাসওয়ার্ড রিসেট করুন', brand: 'QuickMeds Rx', title: 'পাসওয়ার্ড রিসেটের অনুরোধ', hello: 'নমস্কার', intro: 'আপনার QuickMeds Rx অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ পেয়েছি। নতুন নিরাপদ পাসওয়ার্ড বেছে নিতে নিচের বোতামে ক্লিক করুন:', button: 'পাসওয়ার্ড রিসেট করুন', expires: 'এই পাসওয়ার্ড রিসেট লিঙ্কের মেয়াদ', ignore: 'আপনি এই অনুরোধ না করলে এই ইমেল উপেক্ষা করুন।' },
            te: { subject: 'QuickMeds Rx పాస్‌వర్డ్ రీసెట్ చేయండి', brand: 'QuickMeds Rx', title: 'పాస్‌వర్డ్ రీసెట్ అభ్యర్థన', hello: 'నమస్కారం', intro: 'మీ QuickMeds Rx ఖాతా పాస్‌వర్డ్‌ను రీసెట్ చేయమని అభ్యర్థన అందింది. కొత్త సురక్షిత పాస్‌వర్డ్ ఎంచుకోవడానికి దిగువ బటన్‌పై క్లిక్ చేయండి:', button: 'పాస్‌వర్డ్ రీసెట్ చేయండి', expires: 'ఈ పాస్‌వర్డ్ రీసెట్ లింక్ గడువు', ignore: 'మీరు ఈ అభ్యర్థన చేయకపోతే ఈ ఇమెయిల్‌ను పట్టించుకోకండి.' }
        }[locale];
        const targetUrl = resetUrl || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${encodeURIComponent(token)}`;
        const recipientName = name || 'User';

        const subject = copy.subject;
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
    <div class="brand">💊 ${copy.brand}</div>
    <h1>${copy.title}</h1>
    <p>${copy.hello} ${recipientName},</p>
    <p>${copy.intro}</p>
    <div style="text-align: center;">
      <a href="${targetUrl}" class="btn" target="_blank">${copy.button}</a>
    </div>
    <p>${copy.expires} <strong>1 hour</strong>. ${copy.ignore}</p>
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
            const production = process.env.NODE_ENV === 'production';
            logger.warn(`[EmailService:${production ? 'Unavailable' : 'Simulated'}] ${eventType}`, {
                to,
                subject,
                reason: 'SMTP_NOT_CONFIGURED',
                production
            });
            return {
                success: !production,
                simulated: !production,
                error: production ? 'SMTP_NOT_CONFIGURED' : undefined,
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
