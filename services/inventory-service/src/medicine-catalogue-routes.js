import express from 'express';
import { requireServiceScope } from './service-auth.js';
import mongoose from 'mongoose';

const router = express.Router();
const medicineMaster = () => mongoose.models.MedicineMaster;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.use(requireServiceScope('inventory.catalogue.read'));

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page || '1', 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit || '20', 10) || 20));
    const filter = search ? {
      $or: [
        { brandName: { $regex: escapeRegex(search), $options: 'i' } },
        { genericName: { $regex: escapeRegex(search), $options: 'i' } },
        { productName: { $regex: escapeRegex(search), $options: 'i' } },
        { manufacturer: { $regex: escapeRegex(search), $options: 'i' } },
        { composition: { $regex: escapeRegex(search), $options: 'i' } }
      ]
    } : {};
    const Model = medicineMaster();
    const [items, total] = await Promise.all([
      Model.find(filter).sort({ brandName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Model.countDocuments(filter)
    ]);
    return res.json({ items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { return next(error); }
});

router.get('/:medicineId', async (req, res, next) => {
  try {
    const item = await medicineMaster().findOne({ medicineId: req.params.medicineId }).lean();
    if (!item) return res.status(404).json({ message: 'Medicine master record was not found.' });
    return res.json({ medicine: item });
  } catch (error) { return next(error); }
});

export default router;
