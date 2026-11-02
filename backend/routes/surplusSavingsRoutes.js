import express from 'express';
import mongoose from 'mongoose';
import { authenticateUser } from '../middleware/auth.js';
import Tenant from '../models/Tenant.js';
import Medicine from '../models/Medicine.js';
import SurplusSavingsCampaign from '../models/SurplusSavingsCampaign.js';
import SurplusSavingsRedemption from '../models/SurplusSavingsRedemption.js';
import { getIsConnected } from '../config/db.js';

const router = express.Router();
const TENANT_ROLES = new Set(['TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACIST', 'PHARMACY_STAFF', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'BRANCH_ADMIN']);
const PLATFORM_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN']);
const roleOf = req => String(req.user?.role || req.user?.app_metadata?.role || '').toUpperCase();
const isPlatform = req => PLATFORM_ROLES.has(roleOf(req));
const tenantOf = req => String((isPlatform(req) ? req.body?.tenantId || req.query?.tenantId : req.user?.tenantId || req.user?.app_metadata?.tenantId) || '').trim();
const requireCampaignAdmin = (req, res, next) => {
    if (isPlatform(req) || (TENANT_ROLES.has(roleOf(req)) && (req.user?.tenantId || req.user?.app_metadata?.tenantId))) return next();
    return res.status(403).json({ code: 'SURPLUS_SAVINGS_FORBIDDEN', message: 'Pharmacy tenant administrator access is required.' });
};
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const computeDiscount = (price, campaign) => {
    const value = campaign.discountType === 'fixed'
        ? Number(campaign.discountValue)
        : Number(price) * Number(campaign.discountValue) / 100;
    return money(Math.max(0, Math.min(Number(price), campaign.maxDiscountAmount == null ? value : Math.min(value, Number(campaign.maxDiscountAmount)))));
};

router.use(authenticateUser);

router.get('/', async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Surplus Savings are temporarily unavailable.' });
    try {
        const tenantId = String(req.query.tenantId || '').trim();
        if (!tenantId) return res.status(400).json({ code: 'PHARMACY_SELECTION_REQUIRED', message: 'Select a pharmacy to view its surplus savings.' });
        const tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!tenant) return res.status(404).json({ code: 'PHARMACY_UNAVAILABLE', message: 'This pharmacy is not available.' });
        const now = new Date();
        const campaigns = await SurplusSavingsCampaign.find({
            tenantId, status: 'ACTIVE', startsAt: { $lte: now }, endsAt: { $gt: now },
            $or: [{ usageLimit: null }, { $expr: { $lt: ['$usageCount', '$usageLimit'] } }]
        }).sort({ createdAt: -1 }).lean();
        const ids = [...new Set(campaigns.flatMap(c => c.medicineIds.map(String)))];
        if (!ids.length) return res.json({ success: true, tenantId, items: [] });
        const medicines = await Medicine.find({ _id: { $in: ids }, tenantId, isActive: { $ne: false } })
            .select('_id name brand price imageUrl description stockQuantity stock quantity requiresPrescription isPrescriptionRequired')
            .lean();
        const items = [];
        for (const medicine of medicines) {
            const eligible = campaigns.filter(c => c.medicineIds.some(id => String(id) === String(medicine._id)))
                .map(c => ({ campaign: c, discount: computeDiscount(medicine.price, c) }))
                .filter(x => x.discount > 0)
                .sort((a, b) => b.discount - a.discount);
            if (!eligible.length) continue;
            const best = eligible[0];
            const price = Number(medicine.price);
            items.push({
                _id: String(medicine._id), medicineId: String(medicine._id), tenantId,
                name: medicine.name, brand: medicine.brand, imageUrl: medicine.imageUrl || null,
                description: medicine.description || '', originalPrice: price,
                price: money(price - best.discount), discountedPrice: money(price - best.discount),
                savingsAmount: best.discount, discountPercent: price > 0 ? money(best.discount / price * 100) : 0,
                campaignId: String(best.campaign._id), campaignName: best.campaign.name,
                campaignDescription: best.campaign.description, minOrderAmount: Number(best.campaign.minOrderAmount || 0), endsAt: best.campaign.endsAt,
                stock: medicine.stockQuantity ?? medicine.stock ?? medicine.quantity ?? 0,
                isPrescriptionRequired: Boolean(medicine.isPrescriptionRequired ?? medicine.requiresPrescription)
            });
        }
        items.sort((a, b) => b.savingsAmount - a.savingsAmount);
        return res.json({ success: true, tenantId, items });
    } catch (error) {
        console.error('[SurplusSavings] Public campaign lookup failed:', error);
        return res.status(503).json({ message: 'Surplus Savings could not be loaded.' });
    }
});

router.get('/admin', requireCampaignAdmin, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Campaign management is temporarily unavailable.' });
    try {
        const tenantId = tenantOf(req);
        if (!tenantId) return res.status(400).json({ message: 'A tenant is required.' });
        const campaigns = await SurplusSavingsCampaign.find({ tenantId }).sort({ createdAt: -1 }).lean();
        return res.json({ success: true, campaigns });
    } catch (error) {
        return res.status(503).json({ message: 'Could not load campaigns.' });
    }
});

router.post('/admin', requireCampaignAdmin, async (req, res) => {
    if (!getIsConnected()) return res.status(503).json({ message: 'Campaign management is temporarily unavailable.' });
    try {
        const tenantId = tenantOf(req);
        if (!tenantId) return res.status(400).json({ message: 'A tenant is required.' });
        const tenant = await Tenant.findOne({ _id: tenantId, status: 'ACTIVE' }).select('_id').lean();
        if (!tenant) return res.status(404).json({ message: 'Active pharmacy tenant not found.' });
        const name = String(req.body.name || '').trim();
        const medicineIds = [...new Set((Array.isArray(req.body.medicineIds) ? req.body.medicineIds : []).map(String))];
        const discountType = req.body.discountType;
        const discountValue = Number(req.body.discountValue);
        const startsAt = new Date(req.body.startsAt);
        const endsAt = new Date(req.body.endsAt);
        const minOrderAmount = Number(req.body.minOrderAmount || 0);
        const usageLimit = req.body.usageLimit == null || req.body.usageLimit === '' ? null : Number(req.body.usageLimit);
        const perCustomerLimit = Number(req.body.perCustomerLimit || 1);
        const maxDiscountAmount = req.body.maxDiscountAmount == null || req.body.maxDiscountAmount === '' ? null : Number(req.body.maxDiscountAmount);
        if (!name || name.length > 120 || !medicineIds.length || medicineIds.some(id => !mongoose.isValidObjectId(id))) {
            return res.status(400).json({ message: 'Provide a campaign name and valid medicine IDs from this pharmacy.' });
        }
        if (!['percentage', 'fixed'].includes(discountType) || !Number.isFinite(discountValue) || discountValue <= 0 || (discountType === 'percentage' && discountValue > 100)) {
            return res.status(400).json({ message: 'Discount must be a positive fixed amount or a percentage from 1 to 100.' });
        }
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt || !Number.isFinite(minOrderAmount) || minOrderAmount < 0) {
            return res.status(400).json({ message: 'Provide valid campaign dates and a non-negative minimum order amount.' });
        }
        if ((usageLimit != null && (!Number.isInteger(usageLimit) || usageLimit < 1)) || perCustomerLimit !== 1
            || (maxDiscountAmount != null && (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount <= 0))) {
            return res.status(400).json({ message: 'Usage limits and maximum discount must be positive whole-number/amount values.' });
        }
        const medicines = await Medicine.find({ _id: { $in: medicineIds }, tenantId, isActive: { $ne: false } }).select('_id').lean();
        if (medicines.length !== medicineIds.length) return res.status(400).json({ code: 'CROSS_TENANT_MEDICINE', message: 'Campaign products must all belong to the selected pharmacy.' });
        const campaign = await SurplusSavingsCampaign.create({
            tenantId, name, description: String(req.body.description || '').trim().slice(0, 500),
            status: req.body.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
            medicineIds, discountType, discountValue, maxDiscountAmount, minOrderAmount,
            startsAt, endsAt, usageLimit, perCustomerLimit, createdBy: String(req.user.sub)
        });
        return res.status(201).json({ success: true, campaign });
    } catch (error) {
        console.error('[SurplusSavings] Campaign creation failed:', error);
        return res.status(500).json({ message: 'Could not create the campaign.' });
    }
});

router.patch('/admin/:campaignId', requireCampaignAdmin, async (req, res) => {
    if (!getIsConnected() || !mongoose.isValidObjectId(req.params.campaignId)) return res.status(400).json({ message: 'Invalid campaign.' });
    try {
        const tenantId = tenantOf(req);
        if (!tenantId) return res.status(400).json({ message: 'A tenant is required.' });
        const updates = {};
        if (['DRAFT', 'ACTIVE', 'PAUSED'].includes(req.body.status)) updates.status = req.body.status;
        if (req.body.name !== undefined) updates.name = String(req.body.name).trim().slice(0, 120);
        if (req.body.description !== undefined) updates.description = String(req.body.description).trim().slice(0, 500);
        if (req.body.endsAt !== undefined) {
            const endsAt = new Date(req.body.endsAt);
            if (Number.isNaN(endsAt.getTime())) return res.status(400).json({ message: 'Invalid campaign end date.' });
            updates.endsAt = endsAt;
        }
        const campaign = await SurplusSavingsCampaign.findOneAndUpdate({ _id: req.params.campaignId, tenantId }, { $set: updates }, { new: true, runValidators: true });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found in this pharmacy.' });
        return res.json({ success: true, campaign });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Could not update campaign.' });
    }
});

router.delete('/admin/:campaignId', requireCampaignAdmin, async (req, res) => {
    if (!getIsConnected() || !mongoose.isValidObjectId(req.params.campaignId)) return res.status(400).json({ message: 'Invalid campaign.' });
    try {
        const tenantId = tenantOf(req);
        const campaign = await SurplusSavingsCampaign.findOneAndUpdate({ _id: req.params.campaignId, tenantId }, { $set: { status: 'PAUSED' } }, { new: true });
        if (!campaign) return res.status(404).json({ message: 'Campaign not found in this pharmacy.' });
        return res.json({ success: true, campaign, message: 'Campaign paused; existing order snapshots are unchanged.' });
    } catch {
        return res.status(500).json({ message: 'Could not pause campaign.' });
    }
});

export default router;
