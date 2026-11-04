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
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, character => `\\${character}`);
const normHeader = value => String(value ?? '').trim().toLowerCase().replace(/[.\s_/-]+/g, '');
const pick = (row, ...keys) => {
  for (const key of keys) {
    const found = Object.keys(row).find(k => normHeader(k) === normHeader(key));
    if (found && row[found] !== '' && row[found] !== null && row[found] !== undefined) return row[found];
  }
  return undefined;
};
function normalizeRow(raw, tenantId, usedSkus) {
  const name = String(pick(raw, 'Medicine Name', 'medicineName', 'name', 'Name', 'Product Name', 'Item Name') ?? '').trim();
  let sku = String(pick(raw, 'SKU', 'sku', 'Product SKU', 'Barcode', 'Code', 'Item Code') ?? '').trim().toUpperCase();
  const priceRaw = pick(raw, 'Price', 'price', 'MRP/Pk', 'MRP Per Pack', 'MRP', 'Selling Price');
  const stockRaw = pick(raw, 'Stock', 'stock', 'Tot.Bal.Qty', 'Total Balance Qty', 'Quantity', 'Stock Quantity');
  const price = Number(priceRaw);
  const stockQuantity = Number(stockRaw);
  const baseCostRaw = pick(raw, 'Base Cost Price', 'baseCostPrice', 'Cost Price', 'Base Price');
  const baseCostPrice = baseCostRaw === undefined || baseCostRaw === '' ? null : Number(baseCostRaw);
  const marginTier = String(pick(raw, 'Margin Tier', 'marginTier') || 'LOW').trim().toUpperCase();
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
  if (expiryRaw && (!expiryDate || !Number.isFinite(expiryDate.getTime()))) { errors.push('Expiry date is invalid.'); expiryDate = null; }
  if (expiryDate && expiryDate.getTime() < new Date(new Date().toISOString().slice(0, 10)).getTime()) errors.push('Expired medicine batches cannot be published.');
  if (!sku && name) {
    do { sku = `${name.normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase().padEnd(2, 'X')}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`; }
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
    price, stockQuantity, baseCostPrice, marginTier,
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
async function refreshBatchCounts(batchId, tenantId, branchId) {
  const counts = await StagedImportRow.aggregate([
    { $match: { batchId, tenantId, branchId } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const values = Object.fromEntries(counts.map(item => [item._id, item.count]));
  const invalidRows = values.INVALID || 0;
  const totalRows = Object.values(values).reduce((sum, count) => sum + count, 0);
  await StagedImportBatch.updateOne({ batchId, tenantId, branchId }, {
    $set: { totalRows, invalidRows, validRows: totalRows - invalidRows }
  });
}
const asPlain = doc => doc?.toObject ? doc.toObject() : doc;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const comparable = value => value instanceof Date ? value.toISOString()
  : value && typeof value.toHexString === 'function' ? value.toHexString()
    : value == null ? null : value;
const samePreview = (current, expected, fields) => {
  if (!current && !expected) return true;
  if (!current || !expected) return false;
  return fields.every(field => comparable(current[field]) === comparable(expected[field]));
};
const liveInventoryFields = ['tenantId','branchId','productId','sku','stockQuantity','reservedQuantity','price','batchNumber','expiryDate','warehouse','sourceImportBatchId','sourceImportRowId'];
const productFields = ['tenantId','sku','name','genericName','strength','form','manufacturer','category','description','imageUrl','requiresPrescription','baseCostPrice','marginTier','version','lastImportBatchId','lastImportRowId','active'];
function snapshot(doc, fields) {
  if (!doc) return null;
  const out = {};
  for (const key of fields) out[key] = doc[key] ?? null;
  return out;
}
async function assertTransactionSupport() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) throw Object.assign(new Error('Inventory database is unavailable.'), { statusCode: 503 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') throw Object.assign(new Error('Publishing and rollback require MongoDB replica-set or sharded-cluster transactions.'), { statusCode: 503, code: 'IMPORT_TRANSACTIONS_REQUIRED' });
}
async function publishRows(batch, rows, req) {
  if (!rows.length) throw Object.assign(new Error('Select at least one row to publish.'), { statusCode: 400 });
  if (rows.length > 200) throw Object.assign(new Error('Publish at most 200 rows per request. Use multiple batches for larger selections.'), { statusCode: 413 });
  await assertTransactionSupport();
  const session = await mongoose.startSession();
  const published = [];
  try {
    await session.withTransaction(async () => {
      published.length = 0;
      const baselineBatch = await StagedImportBatch.findById(batch._id).session(session).lean();
      if (!baselineBatch || !['READY', 'PARTIALLY_PUBLISHED', 'PUBLISHED'].includes(baselineBatch.status)) throw Object.assign(new Error('This batch is not in a publishable state. Refresh the batch before publishing.'), { statusCode: 409 });
      let inventoryBaseline = [...(baselineBatch?.previewInventorySnapshot || [])];
      let productBaseline = [...(baselineBatch?.previewProductSnapshot || [])];
      for (const row of rows) {
        const fresh = await StagedImportRow.findOne({ _id: row._id, batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
        if (fresh?.status === 'PUBLISHED' && fresh.publication) { published.push(fresh.rowId); continue; }
        if (!fresh || !['READY','UNPUBLISHED'].includes(fresh.status) || fresh.validationErrors.length) {
          throw Object.assign(new Error(`Row ${row.rowNumber} is not ready to publish. Refresh the batch and correct validation errors.`), { statusCode: 409 });
        }
        const v = fresh.normalized;
        if (!v?.sku || !v.name || !Number.isFinite(v.price) || !Number.isSafeInteger(v.stockQuantity)) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber} has invalid normalized data.`), { statusCode: 422 });
        }
        let product = await Product.findOne({ tenantId: batch.tenantId, sku: v.sku }).session(session);
        const expectedProduct = productBaseline.find(item => item.sku === v.sku) || null;
        if (!samePreview(product ? { version: product.version, updatedAt: product.updatedAt } : null, expectedProduct, ['version', 'updatedAt'])) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber}: product catalogue changed after staging. Review the row again before publishing.`), { statusCode: 409 });
        }
        const productBefore = product ? snapshot(asPlain(product), productFields) : null;
        if (!product) product = new Product({ tenantId: batch.tenantId, sku: v.sku });
        Object.assign(product, {
          name: v.name, genericName: v.genericName, strength: v.strength, form: v.form,
          manufacturer: v.manufacturer, category: v.category, description: v.description,
          imageUrl: v.imageUrl, requiresPrescription: v.requiresPrescription, baseCostPrice: v.baseCostPrice ?? undefined, marginTier: v.marginTier || 'LOW',
          lastImportBatchId: batch.batchId, lastImportRowId: fresh.rowId, active: true,
          version: Number(product.version || 0) + 1
        });
        await product.save({ session });
        const productAfter = snapshot(asPlain(product), productFields);
        let inventory = await Inventory.findOne({
          tenantId: batch.tenantId, branchId: batch.branchId,
          productId: product._id, batchNumber: v.batchNumber || ''
        }).session(session);
        const inventoryKey = JSON.stringify([v.sku, v.batchNumber || '']);
        const expectedInventory = inventoryBaseline.find(item => JSON.stringify([item.sku, item.batchNumber || '']) === inventoryKey) || null;
        if (!samePreview(inventory ? { stockQuantity: inventory.stockQuantity, reservedQuantity: inventory.reservedQuantity, price: inventory.price, updatedAt: inventory.updatedAt } : null, expectedInventory, ['stockQuantity', 'reservedQuantity', 'price', 'updatedAt'])) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber}: inventory changed after staging. Review the row again before publishing.`), { statusCode: 409 });
        }
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
          batchNumber: v.batchNumber || '', expiryDate: v.expiryDate || null,
          sourceImportBatchId: batch.batchId, sourceImportRowId: fresh.rowId
        });
        await inventory.save({ session });
        const inventoryAfter = snapshot(asPlain(inventory), liveInventoryFields);
        inventoryBaseline = inventoryBaseline.filter(item => JSON.stringify([item.sku, item.batchNumber || '']) !== inventoryKey);
        inventoryBaseline.push({ sku: v.sku, batchNumber: v.batchNumber || '', stockQuantity: inventory.stockQuantity, reservedQuantity: inventory.reservedQuantity, price: inventory.price, updatedAt: inventory.updatedAt || null });
        productBaseline = productBaseline.filter(item => item.sku !== v.sku);
        productBaseline.push({ sku: v.sku, version: product.version, updatedAt: product.updatedAt || null });
        await StagedImportBatch.updateOne({ _id: batch._id }, { $set: { previewInventorySnapshot: inventoryBaseline, previewProductSnapshot: productBaseline } }, { session });
        const sequenceDoc = await StagedImportBatch.findOneAndUpdate({ _id: batch._id }, { $inc: { nextPublicationSequence: 1 } }, { new: true, session });
        const publication = {
          sequence: sequenceDoc.nextPublicationSequence,
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
      const unpublishedCount = totals.UNPUBLISHED || 0;
      const publishableCount = total - (totals.INVALID || 0);
      await StagedImportBatch.updateOne({ _id: batch._id }, {
        $set: { publishedRows: publishedCount, unpublishedRows: unpublishedCount, status: publishedCount >= publishableCount ? 'PUBLISHED' : 'PARTIALLY_PUBLISHED' }
      }, { session });
      await Audit.create([{
        tenantId: batch.tenantId, branchId: batch.branchId, actor: actor(req),
        operation: 'inventory.import.rows.published',
        details: { batchId: batch.batchId, rowIds: published }
      }], { session });
    });
  } catch (error) {
    if (error?.code === 11000) {
      error.statusCode = 409;
      error.message = 'A product or inventory batch with this identity was created concurrently. Refresh the batch before publishing again.';
    }
    throw error;
  } finally { await session.endSession(); }
  return published;
}
async function unpublishRows(batch, rows, req) {
  if (!rows.length) throw Object.assign(new Error('Select at least one published row.'), { statusCode: 400 });
  if (rows.length > 200) throw Object.assign(new Error('Unpublish at most 200 rows per request.'), { statusCode: 413 });
  await assertTransactionSupport();
  const session = await mongoose.startSession();
  const changed = [];
  try {
    await session.withTransaction(async () => {
      changed.length = 0;
      const baselineBatch = await StagedImportBatch.findById(batch._id).session(session).lean();
      const batchRollbackState = ['REVERTING', 'REVERTED'].includes(baselineBatch?.status);
      let inventoryBaseline = [...(baselineBatch?.previewInventorySnapshot || [])];
      let productBaseline = [...(baselineBatch?.previewProductSnapshot || [])];
      for (const row of [...rows].sort((a,b) => Number(b.publication?.sequence || 0) - Number(a.publication?.sequence || 0))) {
        const fresh = await StagedImportRow.findOne({ _id: row._id, batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
        const p = fresh?.publication;
        if (fresh?.status === 'UNPUBLISHED' && !p) continue;
        if (!fresh || fresh.status !== 'PUBLISHED' || !p) throw Object.assign(new Error('Only published rows can be unpublished.'), { statusCode: 409 });
        const inventory = await Inventory.findOne({ _id: p.inventoryId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
        if (!inventory || !same(snapshot(asPlain(inventory), liveInventoryFields), p.inventoryAfter)) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber} changed after publication. Unpublish stopped to protect newer inventory changes.`), { statusCode: 409 });
        }
        if (Number(inventory.reservedQuantity || 0) > Number(p.inventoryBefore?.stockQuantity || 0)) {
          throw Object.assign(new Error(`Row ${fresh.rowNumber} cannot be reverted because current reservations exceed the previous stock.`), { statusCode: 409 });
        }
        const inventoryKey = JSON.stringify([fresh.normalized.sku, fresh.normalized.batchNumber || '']);
        if (p.inventoryCreated) {
          await Inventory.deleteOne({ _id: inventory._id }).session(session);
          inventoryBaseline = inventoryBaseline.filter(item => JSON.stringify([item.sku, item.batchNumber || '']) !== inventoryKey);
        } else {
          Object.assign(inventory, p.inventoryBefore);
          await inventory.save({ session });
          inventoryBaseline = inventoryBaseline.filter(item => JSON.stringify([item.sku, item.batchNumber || '']) !== inventoryKey);
          inventoryBaseline.push({ sku: inventory.sku, batchNumber: inventory.batchNumber || '', stockQuantity: inventory.stockQuantity, reservedQuantity: inventory.reservedQuantity, price: inventory.price, updatedAt: inventory.updatedAt || null });
        }
        const product = await Product.findOne({ _id: p.productId, tenantId: batch.tenantId }).session(session);
        if (!product || !same(snapshot(asPlain(product), productFields), p.productAfter)) {
          throw Object.assign(new Error(`Product for row ${fresh.rowNumber} changed after publication. Unpublish stopped to protect newer catalogue changes.`), { statusCode: 409 });
        }
        if (p.productCreated) {
          const refs = await Inventory.exists({ tenantId: batch.tenantId, productId: product._id }).session(session);
          if (refs) throw Object.assign(new Error('Product is now used by other inventory rows and cannot be removed safely.'), { statusCode: 409 });
          await Product.deleteOne({ _id: product._id }).session(session);
          productBaseline = productBaseline.filter(item => item.sku !== fresh.normalized.sku);
        } else {
          Object.assign(product, p.productBefore);
          await product.save({ session });
          productBaseline = productBaseline.filter(item => item.sku !== product.sku);
          productBaseline.push({ sku: product.sku, version: product.version, updatedAt: product.updatedAt || null });
        }
        await StagedImportBatch.updateOne({ _id: batch._id }, { $set: { previewInventorySnapshot: inventoryBaseline, previewProductSnapshot: productBaseline } }, { session });
        fresh.history.push({ action: 'UNPUBLISH', actor: actor(req), at: new Date(), version: fresh.version });
        fresh.status = 'UNPUBLISHED';
        fresh.version += 1;
        fresh.publication = null;
        await fresh.save({ session });
        changed.push(fresh.rowId);
      }
      const total = await StagedImportRow.countDocuments({ batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId }).session(session);
      const publishedRows = await StagedImportRow.countDocuments({ batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId, status: 'PUBLISHED' }).session(session);
      const invalidRows = await StagedImportRow.countDocuments({ batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId, status: 'INVALID' }).session(session);
      const unpublishedRows = await StagedImportRow.countDocuments({ batchId: batch.batchId, tenantId: batch.tenantId, branchId: batch.branchId, status: 'UNPUBLISHED' }).session(session);
      const publishableCount = total - invalidRows;
      await StagedImportBatch.updateOne({ _id: batch._id }, {
        $set: { publishedRows, unpublishedRows, status: batchRollbackState ? baselineBatch.status : (publishedRows === 0 ? 'READY' : (publishedRows >= publishableCount ? 'PUBLISHED' : 'PARTIALLY_PUBLISHED')) }
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

router.post('/imports/:jobId([0-9a-fA-F]{24})/retry', requireServiceScope('inventory.import'), (_req, res) => {
  return res.status(410).json({
    code: 'LEGACY_IMPORT_RETRY_DISABLED',
    message: 'Legacy immediate-write import jobs are disabled. Use the staged batch workflow to review and publish test inventory.'
  });
});

router.post('/imports', requireServiceScope('inventory.import'), upload.single('excelFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'An Excel workbook is required.' });
  if (!/\.(xlsx|xls)$/i.test(req.file.originalname)) { await fs.rm(req.file.path, { force: true }).catch(() => {}); return res.status(400).json({ message: 'Upload an .xlsx or .xls workbook.' }); }
  const { tenantId, branchId } = scope(req);
  if (!tenantId || !branchId) { await fs.rm(req.file.path, { force: true }); return res.status(403).json({ message: 'Verified tenant and branch context is required.' }); }
  const key = String(req.get('idempotency-key') || '').trim();
  if (!key || key.length > 128) { await fs.rm(req.file.path, { force: true }); return res.status(400).json({ message: 'A valid Idempotency-Key header is required.' }); }
  try {
    if (req.body?.confirmImport !== 'true' || typeof req.body?.previewFingerprint !== 'string' || !req.body.previewFingerprint.trim()) {
      throw Object.assign(new Error('Review the server preview and explicitly confirm it before staging.'), { statusCode: 400 });
    }
    const fileBytes = await fs.readFile(req.file.path);
    const fileSha256 = createHash('sha256').update(fileBytes).digest('hex');
    const existing = await StagedImportBatch.findOne({ tenantId, branchId, idempotencyKey: key });
    if (existing) {
      if (existing.fileSha256 !== fileSha256) throw Object.assign(new Error('Idempotency key was already used for another workbook.'), { statusCode: 409 });
      return res.status(202).json({ jobId: existing.batchId, batchId: existing.batchId, status: existing.status, totalRecords: existing.totalRows, processedRecords: existing.totalRows, successfulRecords: existing.validRows, failedRecords: existing.invalidRows });
    }
    const approved = await previewImportFile({ filePath: req.file.path, tenantId, branchId });
    if (approved.previewFingerprint !== req.body.previewFingerprint) {
      throw Object.assign(new Error('The workbook differs from the reviewed preview. Preview it again before staging.'), { statusCode: 409 });
    }
    const records = approved.sourceRows || [];
    if (records.length !== approved.rowsDetected) throw Object.assign(new Error('Workbook row mapping changed between preview and staging. Preview the workbook again.'), { statusCode: 409 });
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
    let batch;
    try {
      batch = await StagedImportBatch.create({
        batchId, tenantId, branchId, uploadedBy: actor(req), fileName: cleanName(req.file.originalname),
        fileSha256, idempotencyKey: key, previewInventorySnapshot: approved.inventorySnapshot,
        previewProductSnapshot: approved.productSnapshot, status: 'STAGING', totalRows: documents.length, validRows, invalidRows
      });
    } catch (error) {
      if (error.code === 11000) {
        const duplicate = await StagedImportBatch.findOne({ tenantId, branchId, idempotencyKey: key });
        if (duplicate && duplicate.fileSha256 === fileSha256) {
          return res.status(202).json({ jobId: duplicate.batchId, batchId: duplicate.batchId, status: duplicate.status, totalRecords: duplicate.totalRows, processedRecords: duplicate.totalRows, successfulRecords: duplicate.validRows, failedRecords: duplicate.invalidRows });
        }
        throw Object.assign(new Error('Idempotency key has already been used for a different workbook.'), { statusCode: 409 });
      }
      throw error;
    }
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

router.get('/imports/:jobId([0-9a-fA-F-]{36})', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
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
    StagedImportBatch.find(filter).select('batchId tenantId branchId uploadedBy fileName status totalRows validRows invalidRows publishedRows unpublishedRows createdAt completedAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StagedImportBatch.countDocuments(filter)
  ]);
  return res.json({ items, page, limit, total, pages: Math.ceil(total / limit), publishEnabled: config.importsEnabled });
}));

router.get('/imports/batches/:batchId/rows', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  await safeBatch(req.params.batchId, tenantId, branchId);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = { batchId: req.params.batchId, tenantId, branchId };
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.q) filter.$or = [
    { 'normalized.sku': { $regex: escapeRegex(String(req.query.q).slice(0, 80)), $options: 'i' } },
    { 'normalized.name': { $regex: escapeRegex(String(req.query.q).slice(0, 80)), $options: 'i' } }
  ];
  const [items, total] = await Promise.all([
    StagedImportRow.find(filter).select('batchId tenantId branchId rowId rowNumber originalRecord normalized validationErrors status version publishedAt publishedBy createdAt updatedAt').sort({ rowNumber: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    StagedImportRow.countDocuments(filter)
  ]);
  return res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
}));

router.patch('/imports/batches/:batchId/rows/:rowId', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  await safeBatch(req.params.batchId, tenantId, branchId);
  const row = await StagedImportRow.findOne({ batchId: req.params.batchId, rowId: req.params.rowId, tenantId, branchId });
  if (!row) return res.status(404).json({ message: 'Import row was not found.' });
  if (req.body?.expectedVersion !== undefined && Number(req.body.expectedVersion) !== row.version) return res.status(409).json({ message: 'This row was edited by another user. Reload it before saving your changes.' });
  if (row.status === 'PUBLISHED') return res.status(409).json({ message: 'Unpublish this row before editing it.' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ message: 'Provide row fields to update.' });
  const allowed = ['sku','name','genericName','strength','form','manufacturer','category','description','price','stockQuantity','batchNumber','expiryDate','requiresPrescription','imageUrl','baseCostPrice','marginTier'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const previousNormalized = { ...(row.normalized || {}) };
  const next = { ...row.normalized, ...patch };
  next.sku = String(next.sku || '').trim().toUpperCase();
  next.name = String(next.name || '').trim();
  next.price = Number(next.price);
  next.stockQuantity = Number(next.stockQuantity);
  if (next.baseCostPrice === '') next.baseCostPrice = null;
  else if (next.baseCostPrice !== null && next.baseCostPrice !== undefined) next.baseCostPrice = Number(next.baseCostPrice);
  next.marginTier = String(next.marginTier || 'LOW').toUpperCase();
  next.batchNumber = String(next.batchNumber || '').trim();
  const errors = [];
  if (!next.sku) errors.push('SKU is required.');
  if (!next.name) errors.push('Medicine name is required.');
  if (!Number.isFinite(next.price) || next.price < 0) errors.push('Price must be a non-negative number.');
  if (!Number.isSafeInteger(next.stockQuantity) || next.stockQuantity < 0) errors.push('Stock must be a non-negative integer.');
  if (next.baseCostPrice !== null && next.baseCostPrice !== undefined && (!Number.isFinite(next.baseCostPrice) || next.baseCostPrice < 0)) errors.push('Base cost price must be a non-negative number.');
  if (!['LOW','MID','HIGH'].includes(next.marginTier)) errors.push('Margin tier must be LOW, MID or HIGH.');
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
  if (previousNormalized.sku !== next.sku || (previousNormalized.batchNumber || '') !== (next.batchNumber || '')) {
    const [currentProduct, currentInventory, batchBaseline] = await Promise.all([
      Product.findOne({ tenantId, sku: next.sku }).select('sku version updatedAt').lean(),
      Inventory.findOne({ tenantId, branchId, sku: next.sku, batchNumber: next.batchNumber || '' }).select('sku batchNumber stockQuantity reservedQuantity price updatedAt').lean(),
      StagedImportBatch.findOne({ batchId: row.batchId, tenantId, branchId })
    ]);
    if (batchBaseline) {
      const inventoryKey = JSON.stringify([next.sku, next.batchNumber || '']);
      const inventoryBaseline = (batchBaseline.previewInventorySnapshot || []).filter(item => JSON.stringify([item.sku, item.batchNumber || '']) !== inventoryKey);
      if (currentInventory) inventoryBaseline.push({ sku: currentInventory.sku, batchNumber: currentInventory.batchNumber || '', stockQuantity: currentInventory.stockQuantity, reservedQuantity: currentInventory.reservedQuantity, price: currentInventory.price, updatedAt: currentInventory.updatedAt || null });
      const productBaseline = (batchBaseline.previewProductSnapshot || []).filter(item => item.sku !== next.sku);
      if (currentProduct) productBaseline.push({ sku: currentProduct.sku, version: currentProduct.version, updatedAt: currentProduct.updatedAt || null });
      batchBaseline.previewInventorySnapshot = inventoryBaseline;
      batchBaseline.previewProductSnapshot = productBaseline;
      await batchBaseline.save();
    }
  }
  await refreshBatchCounts(row.batchId, tenantId, branchId);
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
  await refreshBatchCounts(req.params.batchId, tenantId, branchId);
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
  const rows = await StagedImportRow.find({ batchId: batch.batchId, tenantId, branchId, rowId: { $in: ids }, status: { $in: ['PUBLISHED', 'UNPUBLISHED'] } }).sort({ publishedAt: -1 });
  if (rows.length !== ids.length) return res.status(409).json({ message: 'Every selected row must be published or already unpublished.' });
  const changed = await unpublishRows(batch, rows, req);
  return res.json({ success: true, unpublished: changed });
}));

router.post('/imports/batches/:batchId/rollback', requireServiceScope('inventory.import'), requirePublishEnabled, asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  if (batch.status === 'REVERTED') return res.json({ success: true, batchId: batch.batchId, status: 'REVERTED', revertedAt: batch.updatedAt });
  await StagedImportBatch.updateOne({ _id: batch._id, status: { $ne: 'REVERTED' } }, { $set: { status: 'REVERTING' } });
  const rows = (await StagedImportRow.find({ batchId: batch.batchId, tenantId, branchId, status: 'PUBLISHED' }).lean())
    .sort((left, right) => Number(right.publication?.sequence || 0) - Number(left.publication?.sequence || 0));
  // Revert in bounded transactions so large workbooks do not exceed MongoDB's
  // transaction lifetime. Each chunk is atomic and retries continue from the
  // still-published rows if a later chunk encounters a concurrency conflict.
  for (let offset = 0; offset < rows.length; offset += 200) {
    await unpublishRows(batch, rows.slice(offset, offset + 200), req);
  }
  await StagedImportBatch.updateOne({ _id: batch._id }, { $set: { status: 'REVERTED', publishedRows: 0 } });
  await Audit.create({ tenantId, branchId, actor: actor(req), operation: 'inventory.import.batch.reverted', details: { batchId: batch.batchId } });
  return res.json({ success: true, batchId: batch.batchId, status: 'REVERTED', revertedAt: new Date() });
}));

router.get('/imports/batches/:batchId/invalid-records/download', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  const invalidRows = await StagedImportRow.find({
    batchId: batch.batchId, tenantId, branchId, status: 'INVALID'
  }).sort({ rowNumber: 1 }).lean();
  const records = invalidRows.map(row => ({
    ...row.originalRecord,
    SKU: row.normalized?.sku ?? row.originalRecord?.SKU ?? '',
    'Medicine Name': row.normalized?.name ?? row.originalRecord?.['Medicine Name'] ?? '',
    Price: row.normalized?.price ?? row.originalRecord?.Price ?? '',
    Stock: row.normalized?.stockQuantity ?? row.originalRecord?.Stock ?? '',
    'Batch Number': row.normalized?.batchNumber ?? row.originalRecord?.['Batch Number'] ?? '',
    'Expiry Date': row.normalized?.expiryDate ?? row.originalRecord?.['Expiry Date'] ?? '',
    Category: row.normalized?.category ?? row.originalRecord?.Category ?? '',
    'Source Row Number': row.rowNumber,
    'Validation Errors': (row.validationErrors || []).join(' | ')
  }));
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(records), 'Rows Requiring Review');
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="inventory-batch-${batch.batchId}-invalid.xlsx"`);
  return res.send(buffer);
}));

router.get('/imports/batches/:batchId', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  const { tenantId, branchId } = scope(req);
  const batch = await safeBatch(req.params.batchId, tenantId, branchId);
  const counts = await StagedImportRow.aggregate([
    { $match: { batchId: batch.batchId, tenantId, branchId } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  return res.json({
    batch: {
      batchId: batch.batchId, fileName: batch.fileName, status: batch.status,
      totalRows: batch.totalRows, validRows: batch.validRows, invalidRows: batch.invalidRows,
      publishedRows: batch.publishedRows, unpublishedRows: batch.unpublishedRows,
      uploadedBy: batch.uploadedBy, createdAt: batch.createdAt, completedAt: batch.completedAt
    },
    counts: Object.fromEntries(counts.map(x => [x._id, x.count]))
  });
}));

export default router;
