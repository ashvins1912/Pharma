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
import UserProfile from '../../models/UserProfile.js';


const SUPPORTED_EMAIL_LANGUAGES = ['en', 'hi', 'kn', 'bn', 'te'];
const escapeEmailHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const EMAIL_COPY = {
    en: {
        onboardingSubject: 'Welcome to QuickMeds Rx: Pharmacy onboarding confirmation',
        onboardingTitle: 'Pharmacy onboarding confirmation',
        onboardingIntro: 'Your pharmacy has been successfully registered on the QuickMeds Rx multi-tenant healthcare platform.',
        tenantDetails: 'Pharmacy details', pharmacyName: 'Pharmacy name', tenantId: 'Tenant ID',
        codeSlug: 'System code / slug', legalName: 'Legal entity', primaryEmail: 'Primary email',
        phone: 'Contact phone', region: 'Operating region', status: 'Onboarding status',
        adminAccess: 'Primary administrator access', adminEmail: 'Administrator email',
        roleScope: 'Role', invitationToken: 'Invitation token', login: 'Open pharmacy dashboard',
        delivery: 'Email delivery information', serverTime: 'Server timestamp', support: 'For assistance, contact',
        adminSubject: 'QuickMeds Rx administrator invitation',
        adminTitle: 'Pharmacy administrator invitation', hello: 'Hello',
        adminIntro: 'You have been invited to manage this pharmacy on QuickMeds Rx as a tenant administrator.',
        pharmacy: 'Pharmacy', assignedEmail: 'Assigned email', acceptInvite: 'Sign in to accept your invitation',
        inviteToken: 'Invitation token', adminText: 'You have been invited to manage',
        diagnosticSubject: 'SMTP Diagnostic Test - QuickMeds Rx Platform', diagnosticTitle: 'SMTP configuration test',
        diagnosticIntro: 'This is an automated diagnostic message from QuickMeds Rx.',
        smtpServer: 'SMTP server', encryption: 'Encryption', authenticatedUser: 'Authenticated user',
        sender: 'Sender', timestamp: 'Timestamp', ssl: 'SSL (port 465)', starttls: 'STARTTLS (port 587)',
        notSpecified: 'Not specified', active: 'Active', allRights: 'All rights reserved.'
    },
    hi: {
        onboardingSubject: 'QuickMeds Rx में आपका स्वागत है: फ़ार्मेसी ऑनबोर्डिंग की पुष्टि',
        onboardingTitle: 'फ़ार्मेसी ऑनबोर्डिंग की पुष्टि',
        onboardingIntro: 'आपकी फ़ार्मेसी QuickMeds Rx मल्टी-टेनेंट हेल्थकेयर प्लेटफ़ॉर्म पर सफलतापूर्वक पंजीकृत हो गई है।',
        tenantDetails: 'फ़ार्मेसी विवरण', pharmacyName: 'फ़ार्मेसी का नाम', tenantId: 'टेनेंट आईडी',
        codeSlug: 'सिस्टम कोड / स्लग', legalName: 'कानूनी इकाई', primaryEmail: 'प्राथमिक ईमेल',
        phone: 'संपर्क फ़ोन', region: 'संचालन क्षेत्र', status: 'ऑनबोर्डिंग स्थिति',
        adminAccess: 'मुख्य एडमिन एक्सेस', adminEmail: 'एडमिन ईमेल',
        roleScope: 'भूमिका', invitationToken: 'आमंत्रण टोकन', login: 'फ़ार्मेसी डैशबोर्ड खोलें',
        delivery: 'ईमेल डिलीवरी जानकारी', serverTime: 'सर्वर समय', support: 'सहायता के लिए संपर्क करें',
        adminSubject: 'QuickMeds Rx एडमिन आमंत्रण',
        adminTitle: 'फ़ार्मेसी एडमिन आमंत्रण', hello: 'नमस्ते',
        adminIntro: 'आपको QuickMeds Rx पर इस फ़ार्मेसी का टेनेंट एडमिन बनकर प्रबंधन करने के लिए आमंत्रित किया गया है।',
        pharmacy: 'फ़ार्मेसी', assignedEmail: 'निर्धारित ईमेल', acceptInvite: 'आमंत्रण स्वीकार करने के लिए साइन इन करें',
        inviteToken: 'आमंत्रण टोकन', adminText: 'आपको इस फ़ार्मेसी का प्रबंधन करने के लिए आमंत्रित किया गया है:',
        diagnosticSubject: 'QuickMeds Rx SMTP जाँच संदेश', diagnosticTitle: 'SMTP कॉन्फ़िगरेशन जाँच',
        diagnosticIntro: 'यह QuickMeds Rx की ओर से भेजा गया स्वचालित जाँच संदेश है।',
        smtpServer: 'SMTP सर्वर', encryption: 'एन्क्रिप्शन', authenticatedUser: 'प्रमाणित उपयोगकर्ता',
        sender: 'प्रेषक', timestamp: 'समय', ssl: 'SSL (पोर्ट 465)', starttls: 'STARTTLS (पोर्ट 587)',
        notSpecified: 'उल्लेख नहीं किया गया', active: 'सक्रिय', allRights: 'सर्वाधिकार सुरक्षित।'
    },
    kn: {
        onboardingSubject: 'QuickMeds Rx ಗೆ ಸ್ವಾಗತ: ಔಷಧಾಲಯ ನೋಂದಣಿ ದೃಢೀಕರಣ',
        onboardingTitle: 'ಔಷಧಾಲಯ ನೋಂದಣಿ ದೃಢೀಕರಣ',
        onboardingIntro: 'ನಿಮ್ಮ ಔಷಧಾಲಯವನ್ನು QuickMeds Rx ಬಹು-ಟೆನಂಟ್ ಆರೋಗ್ಯ ವೇದಿಕೆಯಲ್ಲಿ ಯಶಸ್ವಿಯಾಗಿ ನೋಂದಾಯಿಸಲಾಗಿದೆ.',
        tenantDetails: 'ಔಷಧಾಲಯದ ವಿವರಗಳು', pharmacyName: 'ಔಷಧಾಲಯದ ಹೆಸರು', tenantId: 'ಟೆನಂಟ್ ಐಡಿ',
        codeSlug: 'ಸಿಸ್ಟಮ್ ಕೋಡ್ / ಸ್ಲಗ್', legalName: 'ಕಾನೂನು ಘಟಕ', primaryEmail: 'ಪ್ರಾಥಮಿಕ ಇಮೇಲ್',
        phone: 'ಸಂಪರ್ಕ ದೂರವಾಣಿ', region: 'ಕಾರ್ಯಾಚರಣೆಯ ಪ್ರದೇಶ', status: 'ನೋಂದಣಿ ಸ್ಥಿತಿ',
        adminAccess: 'ಮುಖ್ಯ ನಿರ್ವಾಹಕರ ಪ್ರವೇಶ', adminEmail: 'ನಿರ್ವಾಹಕರ ಇಮೇಲ್',
        roleScope: 'ಪಾತ್ರ', invitationToken: 'ಆಹ್ವಾನ ಟೋಕನ್', login: 'ಔಷಧಾಲಯ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆಯಿರಿ',
        delivery: 'ಇಮೇಲ್ ವಿತರಣೆಯ ಮಾಹಿತಿ', serverTime: 'ಸರ್ವರ್ ಸಮಯ', support: 'ಸಹಾಯಕ್ಕಾಗಿ ಸಂಪರ್ಕಿಸಿ',
        adminSubject: 'QuickMeds Rx ನಿರ್ವಾಹಕರ ಆಹ್ವಾನ',
        adminTitle: 'ಔಷಧಾಲಯ ನಿರ್ವಾಹಕರ ಆಹ್ವಾನ', hello: 'ನಮಸ್ಕಾರ',
        adminIntro: 'QuickMeds Rx ನಲ್ಲಿ ಈ ಔಷಧಾಲಯವನ್ನು ಟೆನಂಟ್ ನಿರ್ವಾಹಕರಾಗಿ ನಿರ್ವಹಿಸಲು ನಿಮ್ಮನ್ನು ಆಹ್ವಾನಿಸಲಾಗಿದೆ.',
        pharmacy: 'ಔಷಧಾಲಯ', assignedEmail: 'ನಿಯೋಜಿತ ಇಮೇಲ್', acceptInvite: 'ಆಹ್ವಾನ ಸ್ವೀಕರಿಸಲು ಸೈನ್ ಇನ್ ಮಾಡಿ',
        inviteToken: 'ಆಹ್ವಾನ ಟೋಕನ್', adminText: 'ಈ ಔಷಧಾಲಯವನ್ನು ನಿರ್ವಹಿಸಲು ನಿಮ್ಮನ್ನು ಆಹ್ವಾನಿಸಲಾಗಿದೆ:',
        diagnosticSubject: 'QuickMeds Rx SMTP ಪರೀಕ್ಷಾ ಸಂದೇಶ', diagnosticTitle: 'SMTP ಸಂರಚನಾ ಪರೀಕ್ಷೆ',
        diagnosticIntro: 'ಇದು QuickMeds Rx ನಿಂದ ಕಳುಹಿಸಲಾದ ಸ್ವಯಂಚಾಲಿತ ಪರೀಕ್ಷಾ ಸಂದೇಶವಾಗಿದೆ.',
        smtpServer: 'SMTP ಸರ್ವರ್', encryption: 'ಎನ್‌ಕ್ರಿಪ್ಶನ್', authenticatedUser: 'ದೃಢೀಕೃತ ಬಳಕೆದಾರ',
        sender: 'ಕಳುಹಿಸುವವರು', timestamp: 'ಸಮಯ', ssl: 'SSL (ಪೋರ್ಟ್ 465)', starttls: 'STARTTLS (ಪೋರ್ಟ್ 587)',
        notSpecified: 'ನಿರ್ದಿಷ್ಟಪಡಿಸಿಲ್ಲ', active: 'ಸಕ್ರಿಯ', allRights: 'ಎಲ್ಲ ಹಕ್ಕುಗಳನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.'
    },
    bn: {
        onboardingSubject: 'QuickMeds Rx-এ স্বাগতম: ফার্মেসি অনবোর্ডিং নিশ্চিতকরণ',
        onboardingTitle: 'ফার্মেসি অনবোর্ডিং নিশ্চিতকরণ',
        onboardingIntro: 'আপনার ফার্মেসি QuickMeds Rx মাল্টি-টেন্যান্ট স্বাস্থ্যসেবা প্ল্যাটফর্মে সফলভাবে নিবন্ধিত হয়েছে।',
        tenantDetails: 'ফার্মেসির বিবরণ', pharmacyName: 'ফার্মেসির নাম', tenantId: 'টেন্যান্ট আইডি',
        codeSlug: 'সিস্টেম কোড / স্লাগ', legalName: 'আইনি সত্তা', primaryEmail: 'প্রাথমিক ইমেল',
        phone: 'যোগাযোগের ফোন', region: 'পরিচালন অঞ্চল', status: 'অনবোর্ডিং অবস্থা',
        adminAccess: 'প্রধান প্রশাসকের অ্যাক্সেস', adminEmail: 'প্রশাসকের ইমেল',
        roleScope: 'ভূমিকা', invitationToken: 'আমন্ত্রণ টোকেন', login: 'ফার্মেসি ড্যাশবোর্ড খুলুন',
        delivery: 'ইমেল প্রেরণের তথ্য', serverTime: 'সার্ভারের সময়', support: 'সহায়তার জন্য যোগাযোগ করুন',
        adminSubject: 'QuickMeds Rx প্রশাসক আমন্ত্রণ',
        adminTitle: 'ফার্মেসি প্রশাসকের আমন্ত্রণ', hello: 'নমস্কার',
        adminIntro: 'QuickMeds Rx-এ এই ফার্মেসি টেন্যান্ট প্রশাসক হিসেবে পরিচালনার জন্য আপনাকে আমন্ত্রণ জানানো হয়েছে।',
        pharmacy: 'ফার্মেসি', assignedEmail: 'নির্ধারিত ইমেল', acceptInvite: 'আমন্ত্রণ গ্রহণ করতে সাইন ইন করুন',
        inviteToken: 'আমন্ত্রণ টোকেন', adminText: 'এই ফার্মেসি পরিচালনার জন্য আপনাকে আমন্ত্রণ জানানো হয়েছে:',
        diagnosticSubject: 'QuickMeds Rx SMTP পরীক্ষার বার্তা', diagnosticTitle: 'SMTP কনফিগারেশন পরীক্ষা',
        diagnosticIntro: 'এটি QuickMeds Rx থেকে পাঠানো একটি স্বয়ংক্রিয় পরীক্ষামূলক বার্তা।',
        smtpServer: 'SMTP সার্ভার', encryption: 'এনক্রিপশন', authenticatedUser: 'প্রমাণীকৃত ব্যবহারকারী',
        sender: 'প্রেরক', timestamp: 'সময়', ssl: 'SSL (পোর্ট 465)', starttls: 'STARTTLS (পোর্ট 587)',
        notSpecified: 'উল্লেখ করা হয়নি', active: 'সক্রিয়', allRights: 'সর্বস্বত্ব সংরক্ষিত।'
    },
    te: {
        onboardingSubject: 'QuickMeds Rx కు స్వాగతం: ఫార్మసీ ఆన్‌బోర్డింగ్ నిర్ధారణ',
        onboardingTitle: 'ఫార్మసీ ఆన్‌బోర్డింగ్ నిర్ధారణ',
        onboardingIntro: 'మీ ఫార్మసీ QuickMeds Rx మల్టీ-టెనెంట్ హెల్త్‌కేర్ ప్లాట్‌ఫారమ్‌లో విజయవంతంగా నమోదు చేయబడింది.',
        tenantDetails: 'ఫార్మసీ వివరాలు', pharmacyName: 'ఫార్మసీ పేరు', tenantId: 'టెనెంట్ ఐడి',
        codeSlug: 'సిస్టమ్ కోడ్ / స్లగ్', legalName: 'చట్టబద్ధ సంస్థ', primaryEmail: 'ప్రధాన ఇమెయిల్',
        phone: 'సంప్రదింపు ఫోన్', region: 'నిర్వహణ ప్రాంతం', status: 'ఆన్‌బోర్డింగ్ స్థితి',
        adminAccess: 'ప్రధాన నిర్వాహకుని యాక్సెస్', adminEmail: 'నిర్వాహకుని ఇమెయిల్',
        roleScope: 'పాత్ర', invitationToken: 'ఆహ్వాన టోకెన్', login: 'ఫార్మసీ డ్యాష్‌బోర్డ్ తెరవండి',
        delivery: 'ఇమెయిల్ పంపిణీ సమాచారం', serverTime: 'సర్వర్ సమయం', support: 'సహాయం కోసం సంప్రదించండి',
        adminSubject: 'QuickMeds Rx నిర్వాహక ఆహ్వానం',
        adminTitle: 'ఫార్మసీ నిర్వాహక ఆహ్వానం', hello: 'నమస్కారం',
        adminIntro: 'QuickMeds Rxలో ఈ ఫార్మసీని టెనెంట్ నిర్వాహకునిగా నిర్వహించడానికి మిమ్మల్ని ఆహ్వానించారు.',
        pharmacy: 'ఫార్మసీ', assignedEmail: 'కేటాయించిన ఇమెయిల్', acceptInvite: 'ఆహ్వానాన్ని అంగీకరించడానికి సైన్ ఇన్ చేయండి',
        inviteToken: 'ఆహ్వాన టోకెన్', adminText: 'ఈ ఫార్మసీని నిర్వహించడానికి మిమ్మల్ని ఆహ్వానించారు:',
        diagnosticSubject: 'QuickMeds Rx SMTP పరీక్ష సందేశం', diagnosticTitle: 'SMTP కాన్ఫిగరేషన్ పరీక్ష',
        diagnosticIntro: 'ఇది QuickMeds Rx నుండి వచ్చిన ఆటోమేటెడ్ పరీక్షా సందేశం.',
        smtpServer: 'SMTP సర్వర్', encryption: 'ఎన్‌క్రిప్షన్', authenticatedUser: 'ధృవీకరించిన వినియోగదారు',
        sender: 'పంపినవారు', timestamp: 'సమయ ముద్ర', ssl: 'SSL (పోర్ట్ 465)', starttls: 'STARTTLS (పోర్ట్ 587)',
        notSpecified: 'పేర్కొనలేదు', active: 'యాక్టివ్', allRights: 'అన్ని హక్కులు ప్రత్యేకించబడ్డాయి.'
    }
};

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
            from: env.SMTP_FROM || (env.SMTP_USER ? `QuickMeds Rx Platform <${env.SMTP_USER}>` : 'QuickMeds Rx Platform <no-reply@ashvinpharmacy.com>'),
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
            from: effective.from || (effective.user ? `QuickMeds Rx Platform <${effective.user}>` : 'QuickMeds Rx Platform <no-reply@ashvinpharmacy.com>'),
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


    async resolveEmailLanguage(email, explicitLanguage = null) {
        const requested = String(explicitLanguage || '').trim().toLowerCase();
        if (SUPPORTED_EMAIL_LANGUAGES.includes(requested)) return requested;
        if (!email || UserProfile.db?.readyState !== 1) return 'en';
        try {
            const profile = await UserProfile.findOne({ email: String(email).trim().toLowerCase() })
                .select('preferredLanguage').lean();
            return SUPPORTED_EMAIL_LANGUAGES.includes(profile?.preferredLanguage)
                ? profile.preferredLanguage : 'en';
        } catch (error) {
            logger.warn('Could not resolve recipient email language; using English.', { error: error.message });
            return 'en';
        }
    }

    /**
     * Send pharmacy tenant onboarding confirmation in the recipient's saved language.
     */
    async sendTenantOnboardingEmail(tenant, initialAdmin = null, options = {}) {
        if (!tenant) throw new Error('Tenant data is required to send onboarding email.');
        const recipient = tenant.contactEmail || initialAdmin?.email;
        if (!recipient) {
            logger.warn(`Cannot send tenant onboarding email for ${tenant.name}: no recipient email.`);
            return { success: false, skipped: true, message: 'No recipient email specified.' };
        }

        const locale = await this.resolveEmailLanguage(recipient, options.language);
        const copy = EMAIL_COPY[locale];
        const config = this.resolveConfig(tenant, options.smtpConfig);
        const safe = escapeEmailHtml;
        const tenantName = safe(tenant.name || 'Pharmacy');
        const tenantId = safe(tenant.id || '');
        const tenantCode = safe(tenant.code || 'N/A');
        const tenantSlug = safe(tenant.slug || '');
        const legalName = safe(tenant.legalName || tenant.name || '');
        const contactEmail = safe(tenant.contactEmail || copy.notSpecified);
        const contactPhone = safe(tenant.contactPhone || copy.notSpecified);
        const region = safe(`${tenant.timezone || 'Asia/Kolkata'} (${tenant.currency || 'INR'})`);
        const status = safe(tenant.status || copy.active);
        const timestamp = new Date().toLocaleString(locale === 'en' ? 'en-IN' : locale, {
            timeZone: tenant.timezone || 'Asia/Kolkata'
        });
        const portalUrl = options.portalUrl || 'https://ashvinpharmacy.com/admin/login';
        const subject = `🏥 ${copy.onboardingSubject}: ${tenant.name || 'Pharmacy'}`;
        const adminHtml = initialAdmin ? `
            <section style="background:#f1f5f9;border-radius:8px;padding:18px;margin:20px 0">
              <h3>${copy.adminAccess}</h3>
              <p><strong>${copy.adminEmail}:</strong> ${safe(initialAdmin.email)}</p>
              <p><strong>${copy.roleScope}:</strong> TENANT_ADMIN</p>
              ${initialAdmin.invitationToken ? `<p><strong>${copy.invitationToken}:</strong> <code>${safe(initialAdmin.invitationToken)}</code></p>` : ''}
              <p><a href="${safe(portalUrl)}">${copy.login}</a></p>
            </section>` : '';
        const adminText = initialAdmin
            ? `\n${copy.adminAccess}\n${copy.adminEmail}: ${initialAdmin.email}\n${copy.roleScope}: TENANT_ADMIN\n${initialAdmin.invitationToken ? `${copy.invitationToken}: ${initialAdmin.invitationToken}\n` : ''}${copy.login}: ${portalUrl}\n`
            : '';
        const rows = [
            [copy.pharmacyName, tenantName], [copy.tenantId, tenantId],
            [copy.codeSlug, `${tenantCode} / ${tenantSlug}`], [copy.legalName, legalName],
            [copy.primaryEmail, contactEmail], [copy.phone, contactPhone],
            [copy.region, region], [copy.status, status]
        ];
        const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#1e293b">
          <main style="max-width:620px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
            <header style="background:#0369a1;color:#fff;padding:28px"><div>QuickMeds Rx</div><h1>${copy.onboardingTitle}</h1></header>
            <section style="padding:26px"><p>${copy.hello} <strong>${tenantName}</strong>,</p><p>${copy.onboardingIntro}</p>
              <h2>${copy.tenantDetails}</h2><table style="width:100%;border-collapse:collapse">${rows.map(([label,value]) => `<tr><th style="text-align:left;padding:9px;border-bottom:1px solid #eee">${label}</th><td style="padding:9px;border-bottom:1px solid #eee">${value}</td></tr>`).join('')}</table>
              ${adminHtml}
              <section style="background:#f8fafc;padding:14px;margin-top:18px"><strong>${copy.delivery}</strong><p>${safe(config.host)}:${config.port} (${config.secure ? copy.ssl : copy.starttls})</p><p>${copy.sender}: ${safe(config.from)}</p><p>${copy.serverTime}: ${safe(timestamp)}</p></section>
              <p>${copy.support} <a href="mailto:care@ashvinpharmacy.com">care@ashvinpharmacy.com</a>.</p>
            </section><footer style="text-align:center;padding:16px;background:#f1f5f9">${new Date().getFullYear()} QuickMeds Rx. ${copy.allRights}</footer>
          </main></body></html>`;
        const text = [
            copy.onboardingTitle, '', `${copy.hello} ${tenant.name || 'Pharmacy'},`, copy.onboardingIntro, '',
            copy.tenantDetails, ...rows.map(([label,value]) => `${label}: ${String(value).replace(/<[^>]*>/g, '')}`),
            adminText, copy.delivery, `${copy.smtpServer}: ${config.host}:${config.port}`,
            `${copy.sender}: ${config.from}`, `${copy.serverTime}: ${timestamp}`,
            `${copy.support}: care@ashvinpharmacy.com`
        ].join('\n');

        return this.sendEmail({
            to: recipient, subject, html, text, tenant, smtpConfig: options.smtpConfig,
            metadata: { eventType: 'TENANT_ONBOARDED', tenantId: tenant.id, tenantName: tenant.name, adminEmail: initialAdmin?.email || null, language: locale }
        });
    }

    /**
     * Send administrator invitation in the invited administrator's preferred language.
     */
    async sendTenantAdminInvitationEmail(tenant, invite, options = {}) {
        if (!invite?.email) throw new Error('Administrator email is required.');
        const locale = await this.resolveEmailLanguage(invite.email, options.language);
        const copy = EMAIL_COPY[locale];
        const safe = escapeEmailHtml;
        const tenantName = safe(tenant?.name || 'Pharmacy');
        const tenantSlug = safe(tenant?.slug || 'HQ');
        const adminName = safe(invite.name || 'Administrator');
        const email = safe(invite.email);
        const token = invite.invitationToken ? safe(invite.invitationToken) : '';
        const portalUrl = options.portalUrl || 'https://ashvinpharmacy.com/admin/login';
        const subject = `🔐 ${copy.adminSubject}: ${tenant?.name || 'Pharmacy'}`;
        const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#1e293b">
          <main style="max-width:580px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:26px">
            <div style="color:#0284c7;font-weight:800">QuickMeds Rx</div><h1>${copy.adminTitle}</h1>
            <p>${copy.hello} <strong>${adminName}</strong>,</p><p>${copy.adminIntro}</p>
            <section style="background:#f1f5f9;padding:14px;border-radius:8px">
              <p><strong>${copy.pharmacy}:</strong> ${tenantName} (${tenantSlug})</p>
              <p><strong>${copy.assignedEmail}:</strong> ${email}</p>
              ${token ? `<p><strong>${copy.inviteToken}:</strong> <code>${token}</code></p>` : ''}
            </section>
            <p><a href="${safe(portalUrl)}" style="display:inline-block;background:#0284c7;color:#fff;padding:12px 18px;border-radius:7px;text-decoration:none">${copy.acceptInvite}</a></p>
          </main></body></html>`;
        const text = `${copy.adminTitle}\n\n${copy.hello} ${invite.name || 'Administrator'},\n\n${copy.adminIntro}\n${copy.pharmacy}: ${tenant?.name || 'Pharmacy'}\n${copy.assignedEmail}: ${invite.email}\n${token ? `${copy.inviteToken}: ${invite.invitationToken}\n` : ''}${copy.acceptInvite}: ${portalUrl}`;
        return this.sendEmail({
            to: invite.email, subject, html, text, tenant,
            smtpConfig: options.smtpConfig,
            metadata: { eventType: 'ADMIN_INVITED', tenantId: tenant?.id || null, adminEmail: invite.email, language: locale }
        });
    }

    /**
     * Send SMTP diagnostic email using the selected recipient language.
     */
    async sendTestEmail(targetEmail, customConfig = null, language = null) {
        if (!targetEmail) throw new Error('Target test recipient email is required.');
        const locale = await this.resolveEmailLanguage(targetEmail, language);
        const copy = EMAIL_COPY[locale];
        const config = this.resolveConfig(null, customConfig);
        const timestamp = new Date().toISOString();
        const subject = `🧪 ${copy.diagnosticSubject}`;
        const rows = [
            [copy.smtpServer, `${config.host}:${config.port}`],
            [copy.encryption, config.secure ? copy.ssl : copy.starttls],
            [copy.authenticatedUser, config.user || copy.notSpecified],
            [copy.sender, config.from], [copy.timestamp, timestamp]
        ];
        const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc;color:#1e293b">
          <main style="max-width:560px;margin:auto;background:#fff;padding:24px;border-radius:10px"><h2>${copy.diagnosticTitle}</h2><p>${copy.diagnosticIntro}</p>
          <table style="width:100%;border-collapse:collapse">${rows.map(([label,value]) => `<tr><th style="text-align:left;padding:8px">${label}</th><td style="padding:8px">${escapeEmailHtml(value)}</td></tr>`).join('')}</table></main></body></html>`;
        const text = `${copy.diagnosticTitle}\n${copy.diagnosticIntro}\n${rows.map(([label,value]) => `${label}: ${value}`).join('\n')}`;
        return this.sendEmail({
            to: targetEmail, subject, html, text, smtpConfig: customConfig,
            metadata: { eventType: 'DIAGNOSTIC_TEST', language: locale }
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
