import express from 'express';
import mongoose from 'mongoose';
import Rider from '../models/Rider.js';
import { authenticateUser } from '../middleware/auth.js';
import { getIsConnected } from '../config/db.js';

const router = express.Router();
const riderStatuses = ['offline', 'available', 'delivering'];
const vehicleTypes = ['Bike', 'Scooter', 'EV Bike', 'Cycle'];

const requireDatabase = (res) => {
    if (getIsConnected() && mongoose.connection.readyState === 1) return true;
    res.status(503).json({ error: 'MongoDB is unavailable. Rider data was not saved.' });
    return false;
};

const normalizeLocation = (location) => {
    if (!location) return { type: 'Point', coordinates: [77.5946, 12.9716] };
    if (location.type === 'Point' && Array.isArray(location.coordinates)) {
        const [longitude, latitude] = location.coordinates.map(Number);
        if (Number.isFinite(longitude) && Number.isFinite(latitude)
            && longitude >= -180 && longitude <= 180
            && latitude >= -90 && latitude <= 90) {
            return { type: 'Point', coordinates: [longitude, latitude] };
        }
    }
    const latitude = Number(location.lat);
    const longitude = Number(location.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)
        && latitude >= -90 && latitude <= 90
        && longitude >= -180 && longitude <= 180) {
        return { type: 'Point', coordinates: [longitude, latitude] };
    }
    return null;
};

router.use(authenticateUser);

router.post('/', async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const { name, phone, vehicleType = 'Bike', status = 'offline', currentLocation } = req.body || {};
        if (typeof name !== 'string' || !name.trim()
            || typeof phone !== 'string' || !phone.trim()) {
            return res.status(400).json({ error: 'Rider name and phone are required.' });
        }
        if (!vehicleTypes.includes(vehicleType)) {
            return res.status(400).json({ error: 'Vehicle type must be Bike, Scooter, EV Bike, or Cycle.' });
        }
        if (!riderStatuses.includes(status)) {
            return res.status(400).json({ error: `Rider status must be one of: ${riderStatuses.join(', ')}.` });
        }
        const location = normalizeLocation(currentLocation);
        if (!location) {
            return res.status(400).json({ error: 'Location must contain valid latitude/longitude or GeoJSON coordinates.' });
        }

        const existing = await Rider.findOne({ supabaseId: req.user.supabaseId }).lean();
        if (existing) {
            return res.status(400).json({ error: 'A rider profile already exists for this account.' });
        }
        const rider = await Rider.create({
            supabaseId: req.user.supabaseId,
            name: name.trim(),
            phone: phone.trim(),
            mobile: phone.trim(),
            vehicleType,
            status,
            currentLocation: location,
            enabled: true
        });
        return res.status(201).json({ rider: rider.toObject() });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'A rider profile already exists for this account or phone number.' });
        }
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            return res.status(400).json({ error: error.message });
        }
        console.error('Rider profile creation failed:', error);
        return res.status(500).json({ error: 'Could not create rider profile.' });
    }
});

router.get('/profile', async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const rider = await Rider.findOne({ supabaseId: req.user.supabaseId }).lean();
        if (!rider) return res.status(404).json({ error: 'Rider profile not found.' });
        return res.json({ rider });
    } catch (error) {
        console.error('Rider profile retrieval failed:', error);
        return res.status(500).json({ error: 'Could not fetch rider profile.' });
    }
});

export default router;
