import express from 'express';
import mongoose from 'mongoose';
import UserProfile from '../models/UserProfile.js';
import UserAddress from '../models/UserAddress.js';
import { authenticateUser } from '../middleware/auth.js';
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
    let addressLine1 = typeof body.addressLine1 === 'string' ? body.addressLine1.trim() : '';
    if (!addressLine1 && typeof body.addressLine === 'string' && body.addressLine.trim()) {
        addressLine1 = body.addressLine.trim();
    }
    if (!addressLine1) throw Object.assign(new Error('addressLine1 is required.'), { statusCode: 400 });

    const isDefault = body.isDefault === undefined ? false : Boolean(body.isDefault);

    const coordinates = body.coordinates || {};
    let lat = coordinates.lat === undefined ? 12.9716 : Number(coordinates.lat);
    let lng = coordinates.lng === undefined ? 77.5946 : Number(coordinates.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90
        || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        lat = 12.9716;
        lng = 77.5946;
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
        addressLine: String(body.addressLine || addressLine1).trim(),
        coordinates: { lat, lng },
        isDefault
    };
};

router.use(authenticateUser);

router.use((req, res, next) => {
    if (req.user) {
        req.user.supabaseId = req.user.supabaseId || req.user.sub || req.user.id;
    }
    next();
});

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
        const { name: rawName, firstName, lastName, phone, mobile, mobileNumber, dateOfBirth, gender } = req.body || {};
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
        let nextFirstName = firstName;
        let nextLastName = lastName;
        if (nextFirstName === undefined && rawName) {
            const parts = String(rawName).trim().split(/\s+/);
            nextFirstName = parts[0] || '';
            if (nextLastName === undefined) nextLastName = parts.slice(1).join(' ');
        }
        nextFirstName = nextFirstName === undefined
            ? existing?.firstName || existing?.name?.trim().split(/\s+/)[0] || ''
            : String(nextFirstName).trim();
        nextLastName = nextLastName === undefined
            ? existing?.lastName || existing?.name?.trim().split(/\s+/).slice(1).join(' ') || ''
            : String(nextLastName).trim();
        const nextPhone = phone === undefined ? (mobileNumber || mobile || existing?.phone || existing?.mobile || '') : String(phone).trim();
        const name = rawName ? String(rawName).trim() : [nextFirstName, nextLastName].filter(Boolean).join(' ');
        const email = String(req.user.email || existing?.email || '').toLowerCase().trim();
        const nextDob = dateOfBirth || existing?.dateOfBirth || null;
        const nextGender = gender || existing?.gender || null;

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
                    mobileNumber: nextPhone,
                    dateOfBirth: nextDob,
                    gender: nextGender,
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

router.put('/onboarding', async (req, res) => {
    const { firstName, lastName, dateOfBirth, mobileNumber, phone, gender } = req.body || {};
    const effectivePhone = (mobileNumber || phone || '').trim();

    if (!firstName || !firstName.trim()) {
        return res.status(400).json({ success: false, error: 'First name is required.' });
    }
    if (gender && !['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
        return res.status(400).json({ success: false, error: 'Select a valid gender option.' });
    }
    if (!dateOfBirth) {
        return res.status(400).json({ success: false, error: 'Date of birth is required.' });
    }
    const d = new Date(dateOfBirth);
    if (Number.isNaN(d.getTime()) || d > new Date()) {
        return res.status(400).json({ success: false, error: 'Date of birth must be a valid past date.' });
    }
    if (!effectivePhone || effectivePhone.replace(/\D/g, '').length < 10) {
        return res.status(400).json({ success: false, error: 'Valid mobile number with at least 10 digits is required.' });
    }

    if (!requireDatabase(res)) return;
    try {
        const name = [firstName.trim(), lastName?.trim()].filter(Boolean).join(' ');
        const profile = await UserProfile.findOneAndUpdate(
            profileIdentity(req.user.supabaseId),
            {
                $set: {
                    supabaseId: req.user.supabaseId,
                    supabase_user_id: req.user.supabaseId,
                    userId: req.user.supabaseId,
                    firstName: firstName.trim(),
                    lastName: (lastName || '').trim(),
                    name,
                    phone: effectivePhone,
                    mobile: effectivePhone,
                    mobileNumber: effectivePhone,
                    dateOfBirth,
                    gender: gender || null,
                    profileCompleted: true,
                    accountStatus: 'ACTIVE',
                    status: 'ACTIVE'
                }
            },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        ).lean();
        return res.status(200).json({ success: true, profile, message: 'Profile completed successfully.' });
    } catch (error) {
        return respondWithError(res, error, 'Could not complete onboarding.');
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
// The central API router preserves the historical /user/profile mount while
// reusing this route implementation and the application's established auth.
export const legacyProfileRoutes = express.Router();
legacyProfileRoutes.use('/profile', authenticateUser, router);
