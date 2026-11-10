import express from 'express';
import { requireServiceScope } from './service-auth.js';
import mongoose from 'mongoose';
import { rankMedicineMasterMatches } from './medicine-master-matcher.js';

const router = express.Router();
const medicineMaster = () => mongoose.models.MedicineMaster;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.use((req, res, next) => requireServiceScope(
  req.method === 'PATCH' || req.method === 'DELETE' || req.path.endsWith('/audit') ? 'inventory.catalogue.import' : 'inventory.catalogue.read'
)(req, res, next));

router.get('/match', async (req, res, next) => {
  try {
    const read = field => String(req.query[field] || '').trim().slice(0, 120);
    const product = {
      name: read('name'),
      brand: read('brand'),
      genericName: read('genericName'),
      composition: read('composition'),
      strength: read('strength'),
      dosageForm: read('dosageForm'),
      form: read('form'),
      manufacturer: read('manufacturer')
    };
    const terms = [...new Set([product.name, product.brand, product.genericName, product.composition].filter(Boolean))];
    if (!terms.length) return res.status(400).json({ code: 'MEDICINE_MATCH_INPUT_REQUIRED', message: 'Provide a medicine name or generic name to find catalogue details.' });
    const clauses = terms.flatMap(term => {
      const firstToken = String(term).split(/\s+/).filter(Boolean)[0] || term;
      const escaped = '^' + escapeRegex(firstToken);
      return [
        { brandName: { $regex: escaped, $options: 'i' } },
        { productName: { $regex: escaped, $options: 'i' } },
        { genericName: { $regex: escaped, $options: 'i' } },
        { composition: { $regex: escaped, $options: 'i' } }
      ];
    });
    const candidates = await medicineMaster().find(
      { isArchived: { $ne: true }, $or: clauses },
      {
        _id: 0, medicineId: 1, brandName: 1, productName: 1, genericName: 1,
        composition: 1, strength: 1, packSize: 1, dosageForm: 1, medicineType: 1,
        manufacturer: 1, therapeuticClass: 1, chemicalClass: 1, actionClass: 1,
        routes: 1, indications: 1, uses: 1, contraindications: 1, sideEffects: 1,
        drugInteractions: 1, habitForming: 1, requiresPrescription: 1,
        prescriptionVerification: 1, clinicalDataVerification: 1, dataQualityStatus: 1
      }
    ).limit(100).lean();
    const result = rankMedicineMasterMatches(product, candidates);
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    return res.json(result);
  } catch (error) { return next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page || '1', 10) || 1));
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit || '20', 10) || 20));
    const filter = { isArchived: { $ne: true }, ...(search ? {
      $or: [
        { brandName: { $regex: escapeRegex(search), $options: 'i' } },
        { genericName: { $regex: escapeRegex(search), $options: 'i' } },
        { productName: { $regex: escapeRegex(search), $options: 'i' } },
        { manufacturer: { $regex: escapeRegex(search), $options: 'i' } },
        { composition: { $regex: escapeRegex(search), $options: 'i' } },
        { uses: { $regex: escapeRegex(search), $options: 'i' } },
        { sideEffects: { $regex: escapeRegex(search), $options: 'i' } },
        { therapeuticClass: { $regex: escapeRegex(search), $options: 'i' } },
        { chemicalClass: { $regex: escapeRegex(search), $options: 'i' } },
        { actionClass: { $regex: escapeRegex(search), $options: 'i' } },
        { suggestedAlternatives: { $regex: escapeRegex(search), $options: 'i' } }
      ]
    } : {}) };
    const Model = medicineMaster();
    const [items, total] = await Promise.all([
      Model.find(filter).sort({ brandName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Model.countDocuments(filter)
    ]);
    return res.json({ items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { return next(error); }
});

const MEDICINE_EDITABLE_FIELDS = new Set([
  'brandName', 'genericName', 'manufacturer', 'composition', 'strength', 'packSize',
  'dosageForm', 'medicineType', 'therapeuticClass', 'chemicalClass', 'actionClass',
  'uses', 'sideEffects', 'indications', 'contraindications', 'drugInteractions'
]);
const medicineMasterAuditSchema = new mongoose.Schema({
  medicineId: { type: String, required: true, index: true },
  action: { type: String, enum: ['UPDATE', 'ARCHIVE'], required: true },
  actorId: { type: String, default: '' },
  changedFields: { type: [String], default: [] },
  before: { type: mongoose.Schema.Types.Mixed, default: {} },
  after: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });
const MedicineMasterAudit = mongoose.models.MedicineMasterAudit || mongoose.model('MedicineMasterAudit', medicineMasterAuditSchema);

router.patch('/:medicineId', requireServiceScope('inventory.catalogue.import'), async (req, res, next) => {
  try {
    if (req.service?.isPlatformUser !== true) return res.status(403).json({ message: 'Only a platform super administrator can update the shared medicine master catalogue.' });
    const input = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const update = {};
    for (const [field, value] of Object.entries(input)) {
      if (!MEDICINE_EDITABLE_FIELDS.has(field)) continue;
      if (['uses', 'sideEffects', 'indications', 'contraindications', 'drugInteractions'].includes(field)) {
        if (!Array.isArray(value)) return res.status(400).json({ message: field + ' must be an array.' });
        if (value.length > 100) return res.status(400).json({ message: field + ' cannot contain more than 100 values.' });
        update[field] = [...new Set(value.map(item => String(item ?? '').trim().slice(0, 500)).filter(Boolean))];
      } else {
        if (typeof value !== 'string' || !value.trim()) return res.status(400).json({ message: field + ' must be a non-empty string.' });
        update[field] = value.trim().slice(0, 2000);
      }
    }
    const changedFields = Object.keys(update);
    if (!changedFields.length) return res.status(400).json({ message: 'No supported medicine fields were supplied.' });
    const Model = medicineMaster();
    const current = await Model.findOne({ medicineId: req.params.medicineId, isArchived: { $ne: true } }).lean();
    if (!current) return res.status(404).json({ message: 'Medicine master record was not found.' });
    const before = Object.fromEntries(changedFields.map(field => [field, current[field] ?? null]));
    const updated = await Model.findOneAndUpdate(
      { _id: current._id },
      { $set: { ...update, lastManuallyUpdatedBy: String(req.service?.userId || req.service?.sub || ''), lastManuallyUpdatedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
    await MedicineMasterAudit.create({ medicineId: current.medicineId, action: 'UPDATE', actorId: String(req.service?.userId || req.service?.sub || ''), changedFields, before, after: Object.fromEntries(changedFields.map(field => [field, updated[field] ?? null])) });
    return res.json({ medicine: updated, changedFields });
  } catch (error) { return next(error); }
});


router.delete('/:medicineId', requireServiceScope('inventory.catalogue.import'), async (req, res, next) => {
  try {
    if (req.service?.isPlatformUser !== true) return res.status(403).json({ message: 'Only a platform super administrator can delete shared medicine master records.' });
    const medicineId = String(req.params.medicineId || '').trim();
    if (!medicineId) return res.status(400).json({ message: 'A medicine ID is required.' });
    const Model = medicineMaster();
    const current = await Model.findOne({ medicineId, isArchived: { $ne: true } }).lean();
    if (!current) return res.status(404).json({ message: 'Active medicine master record was not found.' });
    const actorId = String(req.service?.userId || req.service?.sub || '');
    const archivedAt = new Date();
    const archived = await Model.findOneAndUpdate(
      { _id: current._id, isArchived: { $ne: true } },
      { $set: { isArchived: true, archivedAt, archivedBy: actorId } },
      { new: true }
    ).lean();
    if (!archived) return res.status(409).json({ message: 'This medicine record was already deleted. Refresh the catalogue.' });
    await MedicineMasterAudit.create({
      medicineId,
      action: 'ARCHIVE',
      actorId,
      changedFields: ['isArchived'],
      before: { isArchived: false, brandName: current.brandName, genericName: current.genericName, composition: current.composition, sourceDatasets: current.sourceDatasets, sourceRecordIds: current.sourceRecordIds },
      after: { isArchived: true, archivedAt, archivedBy: actorId }
    });
    return res.json({ success: true, medicineId, archivedAt, message: 'Medicine master record deleted from the active catalogue. Audit and source provenance have been retained.' });
  } catch (error) { return next(error); }
});

router.get('/:medicineId/audit', requireServiceScope('inventory.catalogue.import'), async (req, res, next) => {
  try {
    if (req.service?.isPlatformUser !== true) return res.status(403).json({ message: 'Only a platform super administrator can inspect medicine master update history.' });
    const items = await MedicineMasterAudit.find({ medicineId: req.params.medicineId }).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ items });
  } catch (error) { return next(error); }
});

router.get('/:medicineId', async (req, res, next) => {
  try {
    const item = await medicineMaster().findOne({ medicineId: req.params.medicineId, isArchived: { $ne: true } }).lean();
    if (!item) return res.status(404).json({ message: 'Medicine master record was not found.' });
    return res.json({ medicine: item });
  } catch (error) { return next(error); }
});

export default router;
