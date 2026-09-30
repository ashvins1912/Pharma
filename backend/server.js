import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
dotenv.config();

import connectDB from './config/db.js';
import medicineRoutes from './routes/medicineRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import riderRoutes from './modules/delivery/routes/riderRoutes.js';
import riderProfileRoutes from './routes/riderProfileRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import assignmentRoutes from './modules/delivery/routes/assignmentRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { csrfProtection } from './security/sessionCookie.js';
import { sanitizeBodyMiddleware, validateLogin } from './security/validator.js';
import dataStore from './dataStore.js';
import DataMartRefreshService from './services/DataMartRefreshService.js';
import { authenticateUser, isAdmin } from './middleware/auth.js';
import {
    getDemoAdminIdentity,
    isDemoAdminEnabled,
    isInstantDemoAdminEnabled,
    issueDemoAdminToken,
    verifyDemoAdminPassword
} from './config/demoAdmin.js';
import {
    getDemoCustomerIdentity,
    isDemoCustomerEnabled,
    issueDemoCustomerToken
} from './config/demoCustomer.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);

const hasValidCoordinates = (coordinates) => {
    if (coordinates?.lat == null || coordinates?.lng == null
        || String(coordinates.lat).trim() === '' || String(coordinates.lng).trim() === '') return false;
    const lat = Number(coordinates?.lat);
    const lng = Number(coordinates?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90
        && lng >= -180 && lng <= 180;
};

const dataMartRefreshService = new DataMartRefreshService();
let isDataMartRefreshRunning = false;
const refreshDataMart = async () => {
    if (isDataMartRefreshRunning) return;
    isDataMartRefreshRunning = true;
    try {
        const result = await dataMartRefreshService.refresh();
        console.info('Medicine data mart refreshed:', result.refreshedCount);
    } catch (error) {
        console.error('Medicine data mart refresh failed:', error);
    } finally {
        isDataMartRefreshRunning = false;
    }
};

connectDB()
    .then(async connected => {
        if (!connected) return;
        await dataStore.ensureCatalogSeeded();
        await refreshDataMart();
        const refreshTimer = setInterval(() => void refreshDataMart(), 15 * 60 * 1000);
        refreshTimer.unref();
    })
    .catch(error => console.error('MongoDB catalog initialization failed:', error));

app.use('/api/auth', authRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/riders', riderProfileRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/admin/whatsapp', whatsappRoutes);
app.use('/api/admin/riders', riderRoutes);
app.use('/api/admin/assignment', assignmentRoutes);

app.post('/api/auth/demo-admin', sanitizeBodyMiddleware, validateLogin, async (req, res) => {
    if (!isDemoAdminEnabled()) {
        return res.status(404).json({ message: 'Demo admin sign-in is disabled.' });
    }
    if (!verifyDemoAdminPassword(req.body?.email, req.body?.password)) {
        return res.status(401).json({ message: 'Invalid demo admin email or password.' });
    }
    try {
        const access_token = await issueDemoAdminToken();
        res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoAdminIdentity() });
    } catch (error) {
        console.error('Demo admin token creation failed:', error);
        res.status(503).json({ message: 'Demo admin sign-in is not configured correctly.' });
    }
});

app.post('/api/auth/demo-admin/instant', async (req, res) => {
    if (!isDemoAdminEnabled() || !isInstantDemoAdminEnabled()) {
        return res.status(404).json({ message: 'Instant demo admin access is disabled.' });
    }
    try {
        const access_token = await issueDemoAdminToken(true);
        res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoAdminIdentity() });
    } catch (error) {
        console.error('Instant demo admin sign-in failed:', error);
        res.status(503).json({ message: 'Instant demo admin access is not configured correctly.' });
    }
});

app.post('/api/auth/demo-customer', async (req, res) => {
    if (!isDemoCustomerEnabled()) {
        return res.status(404).json({ message: 'Demo customer access is disabled.' });
    }
    try {
        const access_token = await issueDemoCustomerToken();
        res.json({ access_token, token_type: 'Bearer', expires_in: 3600, user: getDemoCustomerIdentity() });
    } catch (error) {
        console.error('Demo customer token creation failed:', error);
        res.status(503).json({ message: 'Demo customer access is not configured correctly.' });
    }
});

app.get('/api/auth/session', authenticateUser, (req, res) => {
    res.json(req.user);
});

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
        if (!hasValidCoordinates(address.coordinates)) {
            return res.status(400).json({ message: "Select a valid delivery pin on the map before saving this address." });
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
        if (!hasValidCoordinates(address.coordinates)) {
            return res.status(400).json({ message: "Select a valid delivery pin on the map before saving this address." });
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
app.post('/api/test/seed-medicines', authenticateUser, isAdmin, async (req, res) => {
    try {
        await dataStore.seedMedicines();
        res.status(201).json({ message: "✅ Mock pharmacy catalog with images, stock counts, and expiry dates safely seeded!" });
    } catch (err) {
        res.status(500).json({ message: "Seeding script execution crashed.", error: err.message });
    }
});

// Resilient Express error middleware for API routes
app.use((err, req, res, next) => {
    if (!req.originalUrl?.startsWith('/api')) {
        return next(err);
    }
    if (res.headersSent) {
        return next(err);
    }
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
