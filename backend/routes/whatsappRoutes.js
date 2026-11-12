import express from 'express';
import { authenticateUser, isAdmin } from '../middleware/auth.js';
import {
    ensureWhatsAppSession,
    generateWhatsAppQR,
    disconnectWhatsApp,
    getNotificationLog
} from '../config/whatsapp.js';
import dataStore from '../dataStore.js';

const router = express.Router();

// Get current WhatsApp connection status
router.get('/status', authenticateUser, isAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json(await ensureWhatsAppSession());
    } catch (err) {
        console.error("WhatsApp status check error:", err);
        res.status(500).json({ message: "Failed to retrieve WhatsApp status" });
    }
});

// Generate a fresh WhatsApp Web pairing QR code
router.post('/generate-qr', authenticateUser, isAdmin, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const status = await generateWhatsAppQR();
        dataStore.logAudit(req.user?.sub || 'Admin', 'WHATSAPP_QR_GENERATED', 'SYSTEM', 'WHATSAPP_GATEWAY', {
            deviceName: 'WhatsApp Linked Device'
        });
        res.json(status);
    } catch (err) {
        console.error("WhatsApp QR generation error:", err);
        res.status(502).json({ message: err.message || "Failed to generate WhatsApp QR code" });
    }
});

// Disconnect WhatsApp session
router.post('/disconnect', authenticateUser, isAdmin, async (req, res) => {
    try {
        const status = await disconnectWhatsApp();
        dataStore.logAudit(req.user?.sub || 'Admin', 'WHATSAPP_DISCONNECTED', 'SYSTEM', 'WHATSAPP_GATEWAY', {});
        res.json({
            message: "WhatsApp device disconnected. Mobile notifications paused.",
            status
        });
    } catch (err) {
        console.error("WhatsApp disconnect error:", err);
        res.status(500).json({ message: "Failed to disconnect WhatsApp" });
    }
});

// Get log of dispatched WhatsApp notifications
router.get('/logs', authenticateUser, isAdmin, async (req, res) => {
    try {
        res.json(await getNotificationLog());
    } catch (err) {
        res.status(500).json({ message: "Failed to load notification logs" });
    }
});

export default router;
