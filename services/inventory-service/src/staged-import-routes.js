import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import { config } from './config.js';
import { Product, Inventory, Audit } from './models.js';
import { StagedImportBatch, StagedImportRow } from './staged-import-models.js';
import { previewImportFile } from './imports.js';
import { requireServiceScope } from './service-auth.js';

const router = express.Router();
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
await fs.mkdir(config.importStorage, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: config.importStorage,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: config.maxFileBytes, files: 1 }
});
const scope = req => ({ tenantId: req.service?.tenantId || null, branchId: req.service?.branchId || null });
const actor = req => req.service?.userId || req.service?.name || 'unknown';
const requirePublishEnabled = (_req, res, next) => config.importsEnabled
  ? next()
  : res.status(503).json({ code: 'INVENTORY_IMPORT_PUBLISH_DISABLED', message: 'Batch staging and review are available, but publishing is disabled. Enable INVENTORY_IMPORTS_ENABLED only in the isolated test environment to publish test rows.' });
const cleanName = value => path.basename(String(value || 'upload.xlsx')).replace(/[^a-zA-Z0-9._-]/g, '_');
const normHeader = value => String(value ?? '').trim().toLowerCase().replace(/[.\s_/-]+/g, '');
const pick = (row, ...keys) => {
  for (const key of keys) {
    const found = Object.keys(row).find(k => normHeader(k) === normHeader(key));
    if (found && row[found] !== '' && row[found] !== null && row[found] !== undefined) return row[found];
  }
  return undefined;
};
function workbookRows(filePath) {
  const book = xlsx.readFile(filePath, { cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw Object.assign(new Error('Workbook does not contain a worksheet.'), { statusCode: 400 });
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headerIndex = matrix.findIndex(row => {
    const headers = row.map(normHeader);
    return headers.includes('itemname') && (headers.includes('code') || headers.includes('sku'));
  });
  if (headerIndex >= 0) {
    const headers = matrix[headerIndex].map(v => String(v ?? '').trim());
    const records = [];
    let category = 'General Medicine';
    for (let i = headerIndex + 1; i < matrix.length; i += 1) {
      const cells = matrix[i] || [];
      if (!cells.some(v => v !== '' && v !== null && v !== undefined)) continue;
      const raw = Object.fromEntries(headers.map((h, j) => [h, cells[j] ?? '']));
      const name = String(pick(raw, 'Item Name') ?? '').trim();
      if (!name) continue;
      const price = pick(raw, 'MRP/Pk', 'MRP / Pk', 'MRP');
      const total = pick(raw, 'Tot.Bal.Qty', 'Tot Bal Qty', 'Total Balance Qty');
      const store = pick(raw, 'Str.Qty', 'Store Qty');
      const godown = pick(raw, 'Gdwn.Qty', 'Godown Qty');
      if (![price, total, pick(raw, 'MRP')].some(v => v !== undefined && v !== '' && Number.isFinite(Number(v)))) {
        category = name;
        continue;
      }
      records.push({
        ...raw, SKU: String(pick(raw, 'Code', 'SKU') ?? '').trim(),
        'Medicine Name': name, Price: Number(price ?? pick(raw, 'MRP') ?? 0),
        Stock: total !== undefined && total !== '' ? Number(total) : Number(store || 0) + Number(godown || 0),
        'Batch Number': String(pick(raw, 'Batch No', 'Batch Number') ?? '').trim(),
        'Expiry Date': pick(raw, 'Exp Dt', 'Expiry Date') ?? '',
        Form: String(pick(raw, 'Packing', 'Form') ?? '').trim(),
        Category: category, 'Source Row Number': i + 1
      });
    }
    return records;
  }
  return xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false })
    .map((row, i) => ({ ...row, 'Source Row Number': i + 2 }));
}
function normalizeRow(raw, tenantId, usedSkus) {
  const name = String(pick(raw, 'Medicine Name', 'medicineName', 'name', 'Name', 'Product Name', 'Item Name') ?? '').trim();
  let sku = String(pick(raw, 'SKU', 'sku', 'Product SKU', 'Barcode', 'Code', 'Item Code') ?? '').trim().toUpperCase();
  const priceRaw = pick(raw, 'Price', 'price', 'MRP/Pk', 'MRP Per Pack', 'MRP', 'Selling Price');
  const stockRaw = pick(raw, 'Stock', 'stock', 'Tot.Bal.Qty', 'Total Balance Qty', 'Quantity', 'Stock Quantity');
  const price = Number(priceRaw);
  const stockQuantity = Number(stockRaw);
  const errors = [];
  if (!name) errors.push('Medicine name is required.');
  if (priceRaw === undefined || priceRaw === '' || !Number.isFinite(price) || price < 0) errors.push('Price must be a valid non-negative number.');
  if (stockRaw === undefined || stockRaw === '' || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0) errors.push('Stock must be a non-negative integer.');
  let expiryDate = null;
  const expiryRaw = pick(raw, 'Expiry Date', 'expiryDate', 'Expiry', 'Exp Dt');
  if (expiryRaw instanceof Date) expiryDate = expiryRaw;
  else if (typeof expiryRaw === 'number') {
    const parsed = xlsx.SSF.parse_date_code(expiryRaw);
    if (parsed) expiryDate = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  } else if (expiryRaw) expiryDate = new Date(expiryRaw);
  if (expiryRaw && (!expiryDate || !Number.isFinite(expiryDate.getTime()))) errors.push('Expiry date is invalid.');
  if (expiryDate && expiryDate.getTime() < new Date(new Date().toISOString().slice(0, 10)).getTime()) errors.push('Expired medicine batches cannot be published.');
  if (!sku && name) {
    do { sku = `${name.normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase().padEnd(2, 'X')}${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`; }
    while (usedSkus.has(sku));
  }
  if (sku) usedSkus.add(sku);
  const normalized = {
    sku, name,
    genericName: String(pick(raw, 'Generic Name', 'genericName') || '').trim(),
    strength: String(pick(raw, 'Strength', 'strength') || '').trim(),
    form: String(pick(raw, 'Form', 'form', 'Packing') || '').trim(),
    manufacturer: String(pick(raw, 'Manufacturer', 'manufacturer', 'Brand') || 'Pharmaceutical Standard').trim(),
    category: String(pick(raw, 'Category', 'category') || 'General Medicine').trim(),
    description: String(pick(raw, 'Description', 'description') || '').trim(),
    imageUrl: String(pick(raw, 'Image URL', 'imageUrl') || '').trim(),
    requiresPrescription: ['true', 'yes', '1'].includes(String(pick(raw, 'Requires Prescription', 'requiresPrescription') || '').toLowerCase()),
    price, stockQuantity,
    batchNumber: String(pick(raw, 'Batch Number', 'batchNumber', 'Batch No', 'Batch') || '').trim(),
    expiryDate
  };
  return { normalized, errors };
}
const safeBatch = async (batchId, tenantId, branchId) => {
  const batch = await StagedImportBatch.findOne({ batchId, tenantId, branchId });
  if (!batch) throw Object.assign(new Error('Import batch was not found in this tenant and branch.'), { statusCode: 404 });
  return batch;
};
const asPlain = doc => doc?.toObject ? doc.toObject() : doc;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const liveInventoryFields = ['tenantId','branchId','productId','sku','stockQuantity','reservedQuantity','price','batchNumber','expiryDate','warehouse'];
const productFields = ['tenantId','sku','name','genericName','strength','form','manufacturer','category','description','imageUrl','requiresPrescription','baseCostPrice','marginTier','version','active'];
function snapshot(doc, fields) {
  if (!doc) return null;
  const out = {};
  for (const key of fields) out[key] = doc[key] ?? null;
  return out;
}
async function publishRows(batch, rows, req) {
  if (!rows.length) throw Object.assign(new Error('Select at least one row to publish.'), { statusCode: 400 });
  if (rows.length > 200) throw Object.assign(new Error('Publish at most 200 rows per request. Use multiple batches for larger selections.'), { statusCode: 413 });
  const session = await mongoose.startSession();
  const published = [];
  try {
    await session.withTransaction(async () => {
      for (const row of rows) {
        const fresh = await StagedImportRow.findOne({ _id: row._id, batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
        if (!fresh || !['READY','UNPUBLISHED'].includes(fresh.status) || fresh.validationErrors.length) {
          throw Object.assign(new Error(`Row ${row.rowNumber} is not ready to publish. Refresh the batch and correct validation errors.`), { statusCode: 409 });
        }
        const v = fresh.normalized;
        if (!v?.sku || !v.name || !Number.isFinite(v.price) || !Number.isSafeInteger(v.stockQuantity)) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber} has invalid normalized data.`), { statusCode: 422 });
        }
        let product = await Product.findOne({ tenantId: batch.tenantId, sku: v.sku }).session(session);
        const productBefore = product ? snapshot(asPlain(product), productFields) : null;
        if (!product) product = new Product({ tenantId: batch.tenantId, sku: v.sku });
        Object.assign(product, {
          name: v.name, genericName: v.genericName, strength: v.strength, form: v.form,
          manufacturer: v.manufacturer, category: v.category, description: v.description,
          imageUrl: v.imageUrl, requiresPrescription: v.requiresPrescription, active: true,
          version: Number(product.version || 0) + 1
        });
        await product.save({ session });
        const productAfter = snapshot(asPlain(product), productFields);
        let inventory = await Inventory.findOne({
          tenantId: batch.tenantId, branchId: batch.branchId,
          productId: product._id, batchNumber: v.batchNumber || ''
        }).session(session);
        const inventoryBefore = inventory ? snapshot(asPlain(inventory), liveInventoryFields) : null;
        if (inventory && Number(inventory.reservedQuantity || 0) > v.stockQuantity) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber}: stock cannot be lower than reserved quantity.`), { statusCode: 409 });
        }
        if (!inventory) inventory = new Inventory({
          tenantId: batch.tenantId, branchId: batch.branchId, productId: product._id,
          sku: v.sku, batchNumber: v.batchNumber || '', reservedQuantity: 0, warehouse: 'default'
        });
        Object.assign(inventory, {
          sku: v.sku, price: v.price, stockQuantity: v.stockQuantity,
          batchNumber: v.batchNumber || '', expiryDate: v.expiryDate || null
        });
        await inventory.save({ session });
        const inventoryAfter = snapshot(asPlain(inventory), liveInventoryFields);
        const publication = {
          productId: String(product._id), inventoryId: String(inventory._id),
          productCreated: !productBefore, inventoryCreated: !inventoryBefore,
          productBefore, productAfter, inventoryBefore, inventoryAfter,
          publishedAt: new Date(), publishedBy: actor(req)
        };
        fresh.history.push({ action: 'PUBLISH', actor: actor(req), at: new Date(), version: fresh.version, publication });
        fresh.publication = publication;
        fresh.status = 'PUBLISHED';
        fresh.publishedAt = publication.publishedAt;
        fresh.publishedBy = actor(req);
        fresh.version += 1;
        await fresh.save({ session });
        published.push(fresh.rowId);
      }
      const counts = await StagedImportRow.aggregate([
        { $match: { batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).session(session);
      const totals = Object.fromEntries(counts.map(x => [x._id, x.count]));
      const total = await StagedImportRow.countDocuments({ batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
      const publishedCount = totals.PUBLISHED || 0;
      await StagedImportBatch.updateOne({ _id: batch._id }, {
        $set: { publishedRows: publishedCount, status: publishedCount >= total ? 'PUBLISHED' : 'PARTIALLY_PUBLISHED' }
      }, { session });
      await Audit.create([{
        tenantId: batch.tenantId, branchId: batch.branchId, actor: actor(req),
        operation: 'inventory.import.rows.published',
        details: { batchId: batch.batchId, rowIds: published }
      }], { session });
    });
  } finally { await session.endSession(); }
  return published;
}
async function unpublishRows(batch, rows, req) {
  if (!rows.length) throw Object.assign(new Error('Select at least one published row.'), { statusCode: 400 });
  if (rows.length > 200) throw Object.assign(new Error('Unpublish at most 200 rows per request.'), { statusCode: 413 });
  const session = await mongoose.startSession();
  const changed = [];
  try {
    await session.withTransaction(async () => {
      for (const row of [...rows].sort((a,b) => (b.publishedAt || b.updatedAt) - (a.publishedAt || a.updatedAt))) {
        const fresh = await StagedImportRow.findOne({ _id: row._id, batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
        const p = fresh?.publication;
        if (!fresh || fresh.status !== 'PUBLISHED' || !p) throw Object.assign(new Error('Only published rows can be unpublished.'), { statusCode: 409 });
        const inventory = await Inventory.findOne({ _id: p.inventoryId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
        if (!inventory || !same(snapshot(asPlain(inventory), liveInventoryFields), p.inventoryAfter)) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber} changed after publication. Unpublish stopped to protect newer inventory changes.`), { statusCode: 409 });
        }
        if (Number(inventory.reservedQuantity || 0) > Number(p.inventoryBefore?.stockQuantity || 0)) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber} cannot be reverted because current reservations exceed the previous stock.`), { statusCode: 409 });
        }
        if (p.inventoryCreated) await Inventory.deleteOne({ _id: inventory._id }).session(session);
        else {
          Object.assign(inventory, p.inventoryBefore);
          await inventory.save({ session });
        }
        const product = await Product.findOne({ _id: p.productId, tenantId: batch.tenantId }).session(session);
        if (!product || !same(snapshot(asPlain(product), productFields), p.productAfter)) {
          throw Object.assign(new Error(`Product for row ${fresh.rowNumber} changed after publication. Unpublish stopped to protect newer catalogue changes.`), { statusCode: 409 });
        }
        if (p.productCreated) {
          const refs = await Inventory.exists({ tenantId: batch.tenantId, productId: product._id }).session(session);
          if (refs) throw Object.assign(new Error('Product is now used by other inventory rows and cannot be removed safely.'), { statusCode: 409 });
          await Product.deleteOne({ _id: product._id }).session(session);
        } else {
          Object.assign(product, p.productBefore);
          await product.save({ session });
        }
        fresh.history.push({ action: 'UNPUBLISH', actor: actor(req), at: new Date(), version: fresh.version });
        fresh.status = 'UNPUBLISHED';
        fresh.version += 1;
        fresh.publication = null;
        await fresh.save({ session });
        changed.push(fresh.rowId);
      }
      const total = await StagedImportRow.countDocuments({ batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
      const publishedRows = await StagedImportRow.countDocuments({ batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId, status: 'PUBLISHED' }).session(session);
      await StagedImportBatch.updateOne({ _id: batch._id }, {
        $set: { publishedRows, status: publishedRows === 0 ? 'READY' : (publishedRows === total ? 'PUBLISHED' : 'PARTIALLY_PUBLISHED') }
      }, { session });
      await Audit.create([{
        tenantId: batch.tenantId, branchId: batch.branchId, actor: actor(req),
        operation: 'inventory.import.rows.unpublished',
        details: { batchId: batch.batchId, rowIds: changed }
      }], { session });
    });
  } finally { await session.endSession(); }
  return changed;
}

router.post('/imports', requireServiceScope('inventory.import'), upload.single('excelFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'An Excel workbook is required.' });
  const { tenantId, branchId } = scope(req);
  if (!tenantId || !branchId) { await fs.rm(req.file.path, { force: true }); return res.status(403).json({ message: 'Verified tenant and branch context is required.' }); }
  const key = String(req.get('idempotency-key') || '').trim();
  if (!key || key.length > 128) { await fs.rm(req.file.path, { force: true }); return res.status(400).json({ message: 'A valid Idempotency-Key header is required.' }); }
  try {
    const approved = await previewImportFile({ filePath: req.file.path, tenantId, branchId });
    if (req.body?.confirmImport !== 'true' || approved.previewFingerprint !== req.body?.previewFingerprint) {
      throw Object.assign(new Error('The workbook differs from the reviewed preview. Preview it again before staging.'), { statusCode: 409 });
    }
    const fileBytes = await fs.readFile(req.file.path);
    const fileSha256 = createHash('sha256').update(fileBytes).digest('hex');
    const existing = await StagedImportBatch.findOne({ tenantId, branchId, idempotencyKey: key });
    if (existing) {
      if (existing.fileSha256 !== fileSha256) throw Object.assign(new Error('Idempotency key was already used for another workbook.'), { statusCode: 409 });
      return res.status(202).json({ jobId: existing.batchId, batchId: existing.batchId, status: 'READY', totalRecords: existing.totalRows, processedRecords: existing.totalRows, successfulRecords: existing.validRows, failedRecords: existing.invalidRows });
    }
    const records = workbookRows(req.file.path);
    if (!records.length) throw Object.assign(new Error('Workbook contains no inventory rows.'), { statusCode: 400 });
    const batchId = randomUUID();
    const usedSkus = new Set();
    const seenKeys = new Set();
    const documents = records.map((originalRecord, index) => {
      const { normalized, errors } = normalizeRow(originalRecord, tenantId, usedSkus);
      const keyValue = JSON.stringify([normalized.sku, normalized.batchNumber || '']);
      if (seenKeys.has(keyValue)) errors.push('Duplicate SKU + medicine batch number in this upload.');
      seenKeys.add(keyValue);
      const rowNumber = Number(originalRecord['Source Row Number']) || index + 2;
      return {
        batchId, tenantId, branchId, rowId: `${batchId}:${rowNumber}`, rowNumber,
        originalRecord, normalized, validationErrors: [...new Set(errors)],
        status: errors.length ? 'INVALID' : 'READY'
      };
    });
    const validRows = documents.filter(row => row.status === 'READY').length;
    const invalidRows = documents.length - validRows;
    const batch = await StagedImportBatch.create({
      batchId, tenantId, branchId, uploadedBy: actor(req), fileName: cleanName(req.file.originalname),
      fileSha256, idempotencyKey: key, status: 'STAGING', totalRows: documents.length, validRows, invalidRows
    });
    try {
      for (let i = 0; i < documents.length; i += 500) await StagedImportRow.insertMany(documents.slice(i, i + 500), { ordered: false });
      batch.status = 'READY';
      batch.completedAt = new Date();
      await batch.save();
    } catch (error) {
      await StagedImportRow.deleteMany({ batchId, tenantId, branchId });
      await StagedImportBatch.deleteOne({ _id: batch._id });
      throw error;
    }
    await Audit.create({ tenantId, branchId, actor: actor(req), operation: 'inventory.import.staged', details: { batchId, totalRows: documents.length, validRows, invalidRows, fileSha256 } });
    return res.status(202).json({ jobId: batchId, batchId, status: 'READY', totalRecords: documents.length, processedRecords: documents.length, successfulRecords: validRows, failedRecords: invalidRows });
  } finally { await fs.rm(req.file.path, { force: true }).catch(() => {}); }
}));

router.get('/imports/:jobId', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await StagedImportBatch.findOne({ batchId: req.params.jobId, tenantId, branchId }).lean();
  if (!batch) return res.status(404).json({ message: 'Import batch was not found.' });
  return res.json({
    jobId: batch.batchId, batchId: batch.batchId, fileName: batch.fileName, status: batch.status,
    totalRecords: batch.totalRows, processedRecords: batch.totalRows,
    successfulRecords: batch.validRows, failedRecords: batch.invalidRows,
    publishedRecords: batch.publishedRows, createdAt: batch.createdAt, completedAt: batch.completedAt,
    progress: 100, failedFileAvailable: batch.invalidRows > 0
  });
}));

router.get('/imports/batches', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = { tenantId, branchId };
  const [items, total] = await Promise.all([
    StagedImportBatch.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StagedImportBatch.countDocuments(filter)
  ]);
  return res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
}));

router.get('/imports/batches/:batchId/rows', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  await safeBatch(req.params.batchId, tenantId, branchId);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = { batchId: req.params.batchId, tenantId, branchId };
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.q) filter.$or = [
    { 'normalized.sku': { $regex: String(req.query.q).slice(0, 80), $options: 'i' } },
    { 'normalized.name': { $regex: String(req.query.q).slice(0, 80), $options: 'i' } }
  ];
  const [items, total] = await Promise.all([
    StagedImportRow.find(filter).sort({ rowNumber: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    StagedImportRow.countDocuments(filter)
  ]);
  return res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
}));

router.patch('/imports/batches/:batchId/rows/:rowId', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  await safeBatch(req.params.batchId, tenantId, branchId);
  const row = await StagedImportRow.findOne({ batchId: req.params.batchId, rowId: req.params.rowId, tenantId, branchId });
  if (!row) return res.status(404).json({ message: 'Import row was not found.' });
  if (row.status === 'PUBLISHED') return res.status(409).json({ message: 'Unpublish this row before editing it.' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ message: 'Provide row fields to update.' });
  const allowed = ['sku','name','genericName','strength','form','manufacturer','category','description','price','stockQuantity','batchNumber','expiryDate','requiresPrescription','imageUrl'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const next = { ...row.normalized, ...patch };
  next.sku = String(next.sku || '').trim().toUpperCase();
  next.name = String(next.name || '').trim();
  next.price = Number(next.price);
  next.stockQuantity = Number(next.stockQuantity);
  next.batchNumber = String(next.batchNumber || '').trim();
  const errors = [];
  if (!next.sku) errors.push('SKU is required.');
  if (!next.name) errors.push('Medicine name is required.');
  if (!Number.isFinite(next.price) || next.price < 0) errors.push('Price must be a non-negative number.');
  if (!Number.isSafeInteger(next.stockQuantity) || next.stockQuantity < 0) errors.push('Stock must be a non-negative integer.');
  if (next.expiryDate && !Number.isFinite(new Date(next.expiryDate).getTime())) errors.push('Expiry date is invalid.');
  if (next.expiryDate && new Date(next.expiryDate) < new Date(new Date().toISOString().slice(0,10))) errors.push('Expired medicine batches cannot be published.');
  const duplicate = await StagedImportRow.findOne({ batchId: row.batchId, tenantId, branchId, rowId: { $ne: row.rowId }, 'normalized.sku': next.sku, 'normalized.batchNumber': next.batchNumber });
  if (duplicate) errors.push('Another row in this batch already uses this SKU and medicine batch number.');
  row.history.push({ action: 'EDIT', actor: actor(req), at: new Date(), version: row.version, before: row.normalized, after: next });
  row.normalized = next;
  row.validationErrors = errors;
  row.status = errors.length ? 'INVALID' : 'READY';
  row.version += 1;
  await row.save();
  await Audit.create({ tenantId, branchId, actor: actor(req), operation: 'inventory.import.row.edited', details: { batchId: row.batchId, rowId: row.rowId, fields: Object.keys(patch), validationErrors: errors } });
  return res.json({ item: row });
}));

router.post('/imports/batches/:batchId/rows/edit-selected', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  await safeBatch(req.params.batchId, tenantId, branchId);
  const ids = [...new Set((req.body?.rowIds || []).map(String))];
  if (!ids.length || ids.length > 200) return res.status(400).json({ message: 'Select between 1 and 200 rows.' });
  const results = [];
  for (const rowId of ids) {
    const row = await StagedImportRow.findOne({ batchId: req.params.batchId, rowId, tenantId, branchId });
    if (!row || row.status === 'PUBLISHED') continue;
    const patch = req.body?.patch || {};
    const allowed = ['category','manufacturer','form','requiresPrescription'];
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
    row.normalized = { ...row.normalized, ...safePatch };
    row.history.push({ action: 'BULK_EDIT', actor: actor(req), at: new Date(), version: row.version, patch: safePatch });
    row.version += 1;
    row.status = row.validationErrors.length ? 'INVALID' : 'READY';
    await row.save();
    results.push(row.rowId);
  }
  return res.json({ updated: results.length, rowIds: results });
}));

router.post('/imports/batches/:batchId/publish', requireServiceScope('inventory.import'), requirePublishEnabled, asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  const ids = [...new Set((req.body?.rowIds || []).map(String))];
  if (!ids.length) return res.status(400).json({ message: 'Provide rowIds to publish.' });
  const rows = await StagedImportRow.find({ batchId: batch.batchId, tenantId, branchId, rowId: { $in: ids } }).sort({ rowNumber: 1 });
  if (rows.length !== ids.length) return res.status(404).json({ message: 'One or more selected rows were not found in this batch.' });
  const published = await publishRows(batch, rows, req);
  const latest = await StagedImportBatch.findById(batch._id).lean();
  return res.json({ success: true, published, batch: latest });
}));

router.post('/imports/batches/:batchId/rows/:rowId/publish', requireServiceScope('inventory.import'), requirePublishEnabled, asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  const row = await StagedImportRow.findOne({ batchId: batch.batchId, tenantId, branchId, rowId: req.params.rowId });
  if (!row) return res.status(404).json({ message: 'Import row was not found.' });
  const published = await publishRows(batch, [row], req);
  return res.json({ success: true, published });
}));

router.post('/imports/batches/:batchId/unpublish', requireServiceScope('inventory.import'), requirePublishEnabled, asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  const ids = [...new Set((req.body?.rowIds || []).map(String))];
  if (!ids.length) return res.status(400).json({ message: 'Provide rowIds to unpublish.' });
  const rows = await StagedImportRow.find({ batchId: batch.batchId, tenantId, branchId, rowId: { $in: ids }, status: 'PUBLISHED' }).sort({ publishedAt: -1 });
  if (rows.length !== ids.length) return res.status(409).json({ message: 'Every selected row must be published before unpublishing.' });
  const changed = await unpublishRows(batch, rows, req);
  return res.json({ success: true, unpublished: changed });
}));

router.post('/imports/batches/:batchId/rollback', requireServiceScope('inventory.import'), requirePublishEnabled, asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  const rows = await StagedImportRow.find({ batchId: batch.batchId, tenantId, branchId, status: 'PUBLISHED' }).sort({ publishedAt: -1 });
  if (rows.length) await unpublishRows(batch, rows, req);
  await StagedImportBatch.updateOne({ _id: batch._id }, { $set: { status: 'REVERTED' } });
  await Audit.create({ tenantId, branchId, actor: actor(req), operation: 'inventory.import.batch.reverted', details: { batchId: batch.batchId } });
  return res.json({ success: true, batchId: batch.batchId, status: 'REVERTED', revertedAt: new Date() });
}));

router.get('/imports/batches/:batchId', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  const counts = await StagedImportRow.aggregate([
    { $match: { batchId: batch.batchId, tenantId, branchId } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  return res.json({ batch, counts: Object.fromEntries(counts.map(x => [x._id, x.count])) });
}));

export default router;
