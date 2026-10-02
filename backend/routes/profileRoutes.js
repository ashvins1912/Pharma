import express from 'express';
import mongoose from 'mongoose';
import UserProfile from '../models/UserProfile.js';
import UserAddress from '../models/UserAddress.js';
import { authenticateSupabaseUser } from '../middleware/auth.js';
import { getIsConnected } from '../config/db.js';

const router = express.Router();

const requireDatabase = (res) => {
    if (getIsConnected() && mongoose.connection.readyState === 1) return true;
    res.status(503).json({ success: false, error: 'MongoDB is unavailable. Profile changes were not saved.' });
    return false;
};

const respondWithError = (res, error, fallback) => {
    if (error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({ success: false, error: error.message });
    }
    if (error.code === 11000) {
        return res.status(400).json({ success: false, error: 'A profile already exists for this account.' });
    }
    console.error(fallback, error);
    return res.status(500).json({ success: false, error: fallback });
};

const profileIdentity = (supabaseId) => ({
    $or: [{ supabaseId }, { supabase_user_id: supabaseId }, { userId: supabaseId }]
});

const serializeAddress = (address) => ({
    ...address,
    postalCode: address.postalCode || address.pincode || '',
    pincode: address.pincode || address.postalCode || ''
});

const getAddressFields = (body) => {
    const addressLine1 = typeof body.addressLine1 === 'string' ? body.addressLine1.trim() : '';
    if (!addressLine1) throw Object.assign(new Error('addressLine1 is required.'), { statusCode: 400 });

    const isDefault = body.isDefault === undefined ? false : body.isDefault;
    if (typeof isDefault !== 'boolean') {
        throw Object.assign(new Error('isDefault must be a boolean.'), { statusCode: 400 });
    }

    const coordinates = body.coordinates || {};
    const lat = coordinates.lat === undefined ? 12.9716 : Number(coordinates.lat);
    const lng = coordinates.lng === undefined ? 77.5946 : Number(coordinates.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90
        || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw Object.assign(new Error('Address coordinates must be valid latitude and longitude values.'), { statusCode: 400 });
    }

    const postalCode = String(body.postalCode ?? body.pincode ?? '').trim();
    return {
        label: String(body.label || 'Home').trim(),
        fullName: String(body.fullName || '').trim(),
        mobile: String(body.mobile || '').trim(),
        addressLine1,
        addressLine2: String(body.addressLine2 || '').trim(),
        city: String(body.city || '').trim(),
        state: String(body.state || '').trim(),
        postalCode,
        pincode: postalCode,
        country: String(body.country || 'India').trim(),
        landmark: String(body.landmark || '').trim(),
        addressLine: String(body.addressLine || '').trim(),
        coordinates: { lat, lng },
        isDefault
    };
};

router.use(authenticateSupabaseUser);

router.get('/', async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const [profile, addresses] = await Promise.all([
            UserProfile.findOne(profileIdentity(req.user.supabaseId)).lean(),
            UserAddress.find({ userId: req.user.supabaseId }).sort({ isDefault: -1, createdAt: 1 }).lean()
        ]);
        if (!profile) return res.status(404).json({ success: false, error: 'User profile not found.' });
        return res.status(200).json({
            success: true,
            profile: {
                ...profile,
                supabaseId: profile.supabaseId || profile.supabase_user_id || profile.userId,
                firstName: profile.firstName || profile.name?.trim().split(/\s+/)[0] || '',
                lastName: profile.lastName || profile.name?.trim().split(/\s+/).slice(1).join(' ') || '',
                phone: profile.phone || profile.mobile || ''
            },
            addresses: addresses.map(serializeAddress)
        });
    } catch (error) {
        return respondWithError(res, error, 'Could not fetch profile and addresses.');
    }
});

router.put('/', async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const { firstName, lastName, phone } = req.body || {};
        if (firstName !== undefined && (typeof firstName !== 'string' || firstName.trim().length > 100)) {
            return res.status(400).json({ success: false, error: 'firstName must be a string up to 100 characters.' });
        }
        if (lastName !== undefined && (typeof lastName !== 'string' || lastName.trim().length > 100)) {
            return res.status(400).json({ success: false, error: 'lastName must be a string up to 100 characters.' });
        }
        if (phone !== undefined && (typeof phone !== 'string' || phone.trim().length > 30)) {
            return res.status(400).json({ success: false, error: 'phone must be a string up to 30 characters.' });
        }

        const existing = await UserProfile.findOne(profileIdentity(req.user.supabaseId)).lean();
        const nextFirstName = firstName === undefined
            ? existing?.firstName || existing?.name?.trim().split(/\s+/)[0] || ''
            : firstName.trim();
        const nextLastName = lastName === undefined
            ? existing?.lastName || existing?.name?.trim().split(/\s+/).slice(1).join(' ') || ''
            : lastName.trim();
        const nextPhone = phone === undefined ? existing?.phone || existing?.mobile || '' : phone.trim();
        const name = [nextFirstName, nextLastName].filter(Boolean).join(' ');
        const email = String(req.user.email || existing?.email || '').toLowerCase().trim();

        const profile = await UserProfile.findOneAndUpdate(
            profileIdentity(req.user.supabaseId),
            {
                $set: {
                    supabaseId: req.user.supabaseId,
                    supabase_user_id: req.user.supabaseId,
                    userId: req.user.supabaseId,
                    firstName: nextFirstName,
                    lastName: nextLastName,
                    name,
                    phone: nextPhone,
                    mobile: nextPhone,
                    email
                }
            },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        ).lean();
        return res.status(200).json({ success: true, profile });
    } catch (error) {
        return respondWithError(res, error, 'Could not update profile.');
    }
});

router.post('/addresses', async (req, res) => {
    if (!requireDatabase(res)) return;
    try {
        const fields = getAddressFields(req.body || {});
        const existingCount = await UserAddress.countDocuments({ userId: req.user.supabaseId });
        fields.isDefault = fields.isDefault || existingCount === 0;
        if (fields.isDefault) {
            await UserAddress.updateMany({ userId: req.user.supabaseId }, { $set: { isDefault: false } });
        }
        const address = await UserAddress.create({ ...fields, userId: req.user.supabaseId });
        return res.status(201).json({ success: true, address: serializeAddress(address.toObject()) });
    } catch (error) {
        if (error.statusCode === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        return respondWithError(res, error, 'Could not create address.');
    }
});

router.delete('/addresses/:addressId', async (req, res) => {
    if (!requireDatabase(res)) return;
    if (!mongoose.isValidObjectId(req.params.addressId)) {
        return res.status(400).json({ success: false, error: 'addressId must be a valid address ID.' });
    }
    try {
        const deleted = await UserAddress.findOneAndDelete({
            _id: req.params.addressId,
            userId: req.user.supabaseId
        });
        if (!deleted) return res.status(404).json({ success: false, error: 'Address not found.' });

        if (deleted.isDefault) {
            const nextAddress = await UserAddress.findOne({ userId: req.user.supabaseId })
                .sort({ createdAt: 1, _id: 1 });
            if (nextAddress) {
                nextAddress.isDefault = true;
                await nextAddress.save();
            }
        }
        const addresses = await UserAddress.find({ userId: req.user.supabaseId })
            .sort({ isDefault: -1, createdAt: 1 })
            .lean();
        return res.status(200).json({
            success: true,
            addressId: req.params.addressId,
            addresses: addresses.map(serializeAddress)
        });
    } catch (error) {
        return respondWithError(res, error, 'Could not delete address.');
    }
});

export default router;
