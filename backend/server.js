import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import connectDB from './config/db.js';
import medicineRoutes from './routes/medicineRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import dataStore from './dataStore.js';
import { authenticateUser, isAdmin } from './middleware/auth.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

connectDB()
    .then(connected => connected && dataStore.ensureCatalogSeeded())
    .catch(error => console.error('MongoDB catalog initialization failed:', error));

app.use('/api/medicines', medicineRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/admin/whatsapp', whatsappRoutes);

// User Profile & Addresses
app.post('/api/user/profile', authenticateUser, async (req, res) => {
    try {
        const profile = await dataStore.saveUserProfile(req.user.sub, {
            name: req.body.name,
            email: req.user.email,
            mobile: req.body.mobile
        });
        res.json(profile);
    } catch (err) {
        console.error("Profile save error:", err);
        res.status(500).json({ message: "Failed to update profile" });
    }
});

app.get('/api/user/addresses', authenticateUser, async (req, res) => {
    try {
        res.json(await dataStore.getUserAddresses(req.user.sub));
    } catch (err) {
        console.error("Address list error:", err);
        res.status(500).json({ message: "Failed to fetch addresses" });
    }
});

app.post('/api/user/addresses', authenticateUser, async (req, res) => {
    try {
        const address = req.body;
        if (!address?.addressLine1?.trim()) {
            return res.status(400).json({ message: "Street address is required." });
        }
        res.status(201).json(await dataStore.createUserAddress(req.user.sub, address));
    } catch (err) {
        console.error("Address create error:", err);
        res.status(500).json({ message: "Failed to save address" });
    }
});

app.patch('/api/user/addresses/:addressId', authenticateUser, async (req, res) => {
    try {
        const address = req.body;
        if (!address?.addressLine1?.trim()) {
            return res.status(400).json({ message: "Street address is required." });
        }
        const updated = await dataStore.updateUserAddress(req.user.sub, req.params.addressId, address);
        if (!updated) return res.status(404).json({ message: "Address not found." });
        res.json(updated);
    } catch (err) {
        console.error("Address update error:", err);
        res.status(500).json({ message: "Failed to update address" });
    }
});

app.delete('/api/user/addresses/:addressId', authenticateUser, async (req, res) => {
    try {
        const deleted = await dataStore.deleteUserAddress(req.user.sub, req.params.addressId);
        if (!deleted) return res.status(404).json({ message: "Address not found." });
        res.json({ message: "Address deleted." });
    } catch (err) {
        console.error("Address delete error:", err);
        res.status(500).json({ message: "Failed to delete address" });
    }
});

app.get('/api/user/profile', authenticateUser, async (req, res) => {
    try {
        const profile = await dataStore.getUserProfile(req.user.sub);
        res.json(profile);
    } catch (err) {
        console.error("Profile get error:", err);
        res.status(500).json({ message: "Failed to fetch profile" });
    }
});

// Admin Audit Logs endpoint
app.get('/api/admin/audit-logs', authenticateUser, isAdmin, async (req, res) => {
    res.json(dataStore.getAuditLogs());
});

// Seed data
app.post('/api/test/seed-medicines', async (req, res) => {
    try {
        await dataStore.seedMedicines();
        res.status(201).json({ message: "✅ Mock pharmacy catalog with images, stock counts, and expiry dates safely seeded!" });
    } catch (err) {
        res.status(500).json({ message: "Seeding script execution crashed.", error: err.message });
    }
});

// Resilient Express error middleware
app.use((err, req, res, next) => {
    if (err.name === 'MongooseError' || err.name === 'MongoNetworkError' || (err.message && err.message.includes('buffering timed out'))) {
        console.warn('[AI Studio] Database offline — returning mock fallback response');
        if (req.method === 'GET') {
            return res.json(req.path.endsWith('s') || req.path.endsWith('s/') ? [] : {});
        }
        return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
    }
    console.error("Unhandled server error:", err);
    res.status(500).json({ message: err.message || "Internal server error" });
});

export default app;
