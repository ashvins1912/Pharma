import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { config } from './config.js';
import { ImportJob } from './models.js';
import {
  buildFailureWorkbook,
  createImportJob,
  getImportFailures,
  retryImportJob,
  previewImportFile,
  rollbackImportBatch
} from './imports.js';
import {
  adjustInventory,
  lookupInventory,
  searchInventoryProducts,
  reserveInventory,
  transitionReservation
} from './inventory.js';
import { requireServiceScope } from './service-auth.js';

const router = express.Router();
const asyncHandler = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
await fs.mkdir(config.importStorage, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: config.importStorage,
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: config.maxFileBytes, files: 1 }
});

router.get('/products/search', requireServiceScope('inventory.read'), asyncHandler(async (req, res) => {
  const result = await searchInventoryProducts({
    tenantId: req.query.tenantId || null,
    branchId: req.query.branchId || null,
    query: req.query.q || '',
    category: req.query.category || '',
    page: req.query.page || 1,
    limit: req.query.limit || 50
  });
  return res.json(result);
}));

router.get('/products/:productId', requireServiceScope('inventory.read'), asyncHandler(async (req, res) => {
  const result = await lookupInventory({ productIds: [req.params.productId] });
  if (!result.length) return res.status(404).json({ message: 'Product was not found.' });
  return res.json(result[0]);
}));

router.get('/:productId', requireServiceScope('inventory.read'), asyncHandler(async (req, res) => {
  const result = await lookupInventory({ productIds: [req.params.productId] });
  if (!result.length) return res.status(404).json({ message: 'Inventory item was not found.' });
  return res.json(result[0]);
}));

router.post('/bulk/lookup', requireServiceScope('inventory.read'), asyncHandler(async (req, res) => {
  return res.json({ items: await lookupInventory(req.body || {}) });
}));

router.post('/check-availability', requireServiceScope('inventory.read'), asyncHandler(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100
    || items.some(item => typeof item?.productId !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    return res.status(400).json({ message: 'Provide 1 to 100 items with a productId and positive integer quantity.' });
  }
  const requested = new Map();
  for (const item of items) {
    const productId = item.productId.toLowerCase();
    const quantity = (requested.get(productId) || 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) {
      return res.status(400).json({ message: 'Combined product quantity exceeds the supported range.' });
    }
    requested.set(productId, quantity);
  }
  const inventory = await lookupInventory({ productIds: [...requested.keys()] });
  const byProductId = new Map(inventory.map(item => [item.productId, item]));
  const availability = [...requested].map(([productId, quantity]) => {
    const current = byProductId.get(productId);
    return {
      productId,
      requestedQuantity: quantity,
      availableQuantity: current?.availableQuantity || 0,
      available: Boolean(current && current.availableQuantity >= quantity)
    };
  });
  return res.json({ available: availability.every(item => item.available), items: availability });
}));

router.post('/reservations', requireServiceScope('inventory.reserve'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey;
  const result = await reserveInventory({
    ...req.body,
    idempotencyKey,
    actor: req.service.name,
    requestId: req.requestId,
    correlationId: req.correlationId
  });
  return res.status(201).json({ success: true, ...result });
}));

router.post('/reservations/:reservationId/release', requireServiceScope('inventory.release'), asyncHandler(async (req, res) => {
  const result = await transitionReservation(req.params.reservationId, 'RELEASED', {
    actor: req.service.name,
    requestId: req.requestId,
    correlationId: req.correlationId
  });
  return res.json(result);
}));

router.post('/reservations/:reservationId/deduct', requireServiceScope('inventory.deduct'), asyncHandler(async (req, res) => {
  const result = await transitionReservation(req.params.reservationId, 'DEDUCTED', {
    actor: req.service.name,
    requestId: req.requestId,
    correlationId: req.correlationId
  });
  return res.json(result);
}));

router.post('/adjust', requireServiceScope('inventory.adjust'), asyncHandler(async (req, res) => {
  const result = await adjustInventory({
    ...req.body,
    operationKey: req.get('idempotency-key') || req.body?.operationKey,
    actor: req.service.userId || req.service.name,
    requestId: req.requestId,
    correlationId: req.correlationId
  });
  return res.json(result);
}));

router.post('/imports/preview', requireServiceScope('inventory.import'), upload.single('excelFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'An Excel workbook is required.' });
  if (!/\.(xlsx|xls)$/i.test(req.file.originalname)) { await fs.rm(req.file.path, { force: true }).catch(() => {}); return res.status(400).json({ message: 'Upload an .xlsx or .xls workbook.' }); }
  const isPlatformUser = req.service?.isPlatformUser === true;
  const tenantId = isPlatformUser ? String(req.get('x-tenant-id') || '').trim() : String(req.service?.tenantId || '').trim();
  const branchId = isPlatformUser ? String(req.get('x-branch-id') || '').trim() : String(req.service?.branchId || '').trim();
  if (!tenantId || !branchId) { await fs.rm(req.file.path, { force: true }).catch(() => {}); return res.status(403).json({ message: 'Verified tenant and branch selection is required.' }); }
  try { return res.json(await previewImportFile({ filePath: req.file.path, tenantId, branchId })); }
  finally { await fs.rm(req.file.path, { force: true }).catch(() => {}); }
}));
router.post('/imports', requireServiceScope('inventory.import'), upload.single('excelFile'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'An Excel workbook is required.' });
  if (!/\.(xlsx|xls)$/i.test(req.file.originalname)) {
    await fs.rm(req.file.path, { force: true }).catch(() => {});
    return res.status(400).json({ message: 'Upload an .xlsx or .xls workbook.' });
  }
  const idempotencyKey = req.get('idempotency-key');
  if (!idempotencyKey?.trim() || idempotencyKey.length > 128) {
    await fs.rm(req.file.path, { force: true }).catch(() => {});
    return res.status(400).json({ message: 'A valid Idempotency-Key header is required.' });
  }

  const isPlatformUser = req.service?.isPlatformUser === true;
  const tenantId = isPlatformUser ? String(req.get('x-tenant-id') || '').trim() : String(req.service?.tenantId || '').trim();
  const branchId = isPlatformUser ? String(req.get('x-branch-id') || '').trim() : String(req.service?.branchId || '').trim();
  if (!tenantId || !branchId) { await fs.rm(req.file.path, { force: true }).catch(() => {}); return res.status(403).json({ message: 'Verified tenant and branch selection is required.' }); }

  try {
    if (req.body?.confirmImport !== 'true' || typeof req.body?.previewFingerprint !== 'string' || !req.body.previewFingerprint.trim()) {
      await fs.rm(req.file.path, { force: true }).catch(() => {});
      return res.status(400).json({ message: 'Review the server preview and explicitly confirm it before importing.' });
    }
    const approvedPreview = await previewImportFile({ filePath: req.file.path, tenantId, branchId });
    if (approvedPreview.previewFingerprint !== req.body.previewFingerprint) {
      await fs.rm(req.file.path, { force: true }).catch(() => {});
      return res.status(409).json({ message: 'The uploaded workbook or tenant/branch selection differs from the approved preview. Preview again before importing.' });
    }
    const job = await createImportJob({
      file: req.file,
      fileName: req.file.originalname,
      uploadedBy: req.service.userId || req.service.name,
      idempotencyKey: idempotencyKey.trim(),
      tenantId,
      branchId,
      previewFingerprint: approvedPreview.previewFingerprint,
      stockMode: String(req.body?.stockMode || 'REPLACE').toUpperCase()
    });
    return res.status(202).json({
      jobId: String(job._id),
      batchId: job.batchId,
      idempotencyKey: job.idempotencyKey,
      status: job.status,
      totalRecords: job.totalRecords || 0,
      processedRecords: job.processedRecords || 0,
      successfulRecords: job.successfulRecords || 0,
      failedRecords: job.failedRecords || 0
    });
  } catch (error) {
    await fs.rm(req.file.path, { force: true }).catch(() => {});
    throw error;
  }
}));

router.get('/imports/:jobId', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.jobId)) return res.status(404).json({ message: 'Import job was not found.' });
  const isPlatformUser = req.service?.isPlatformUser === true;
  const tenantId = isPlatformUser ? String(req.get('x-tenant-id') || '').trim() : req.service?.tenantId;
  const branchId = isPlatformUser ? String(req.get('x-branch-id') || '').trim() : req.service?.branchId;
  if (!isPlatformUser && (!tenantId || !branchId)) return res.status(403).json({ message: 'Verified tenant and branch context is required.' });
  const filter = { _id: req.params.jobId };
  if (tenantId) filter.tenantId = tenantId;
  if (branchId) filter.branchId = branchId;
  const job = await ImportJob.findOne(filter).lean();
  if (!job) return res.status(404).json({ message: 'Import job was not found.' });
  return res.json({
    jobId: String(job._id),
    batchId: job.batchId,
    fileName: job.fileName,
    status: job.status,
    totalRecords: job.totalRecords,
    processedRecords: job.processedRecords,
    successfulRecords: job.successfulRecords,
    insertedRecords: job.insertedRecords,
    updatedRecords: job.updatedRecords,
    failedRecords: job.failedRecords,
    retryCount: job.retryCount,
    progress: job.totalRecords ? Math.round(job.processedRecords / job.totalRecords * 1000) / 10 : 0,
    failedFileAvailable: ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.status) && job.failedRecords > 0,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    errorMessage: job.errorMessage
  });
}));

router.get('/imports/:jobId/failures', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.jobId)) return res.status(404).json({ message: 'Import job was not found.' });
  const isPlatformUser = req.service?.isPlatformUser === true;
  const tenantId = isPlatformUser ? String(req.get('x-tenant-id') || '').trim() : req.service?.tenantId;
  const branchId = isPlatformUser ? String(req.get('x-branch-id') || '').trim() : req.service?.branchId;
  if (!isPlatformUser && (!tenantId || !branchId)) return res.status(403).json({ message: 'Verified tenant and branch context is required.' });
  const filter = { _id: req.params.jobId };
  if (tenantId) filter.tenantId = tenantId;
  if (branchId) filter.branchId = branchId;
  const job = await ImportJob.findOne(filter).lean();
  if (!job) return res.status(404).json({ message: 'Import job was not found.' });

  const failures = await getImportFailures(req.params.jobId, tenantId || null, branchId || null);
  return res.json({ failures });
}));

router.get('/imports/:jobId/failures/download', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.jobId)) return res.status(404).json({ message: 'Import job was not found.' });
  const isPlatformUser = req.service?.isPlatformUser === true;
  const tenantId = isPlatformUser ? String(req.get('x-tenant-id') || '').trim() : req.service?.tenantId;
  const branchId = isPlatformUser ? String(req.get('x-branch-id') || '').trim() : req.service?.branchId;
  if (!isPlatformUser && (!tenantId || !branchId)) return res.status(403).json({ message: 'Verified tenant and branch context is required.' });
  const filter = { _id: req.params.jobId };
  if (tenantId) filter.tenantId = tenantId;
  if (branchId) filter.branchId = branchId;
  const job = await ImportJob.findOne(filter).lean();
  if (!job) return res.status(404).json({ message: 'Import job was not found.' });

  const failures = await getImportFailures(req.params.jobId, tenantId || null, branchId || null);
  if (!failures.length) return res.status(404).json({ message: 'This import has no failed records.' });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="Inventory_Failures_${req.params.jobId}.xlsx"`,
    'Cache-Control': 'private, no-store'
  });
  return res.send(buildFailureWorkbook(failures));
}));

router.post('/imports/batches/:batchId/rollback', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.batchId)) return res.status(404).json({ message: 'Import batch was not found.' });
  const isPlatformUser = req.service?.isPlatformUser === true;
  const tenantId = isPlatformUser ? String(req.get('x-tenant-id') || '').trim() : String(req.service?.tenantId || '').trim();
  const branchId = isPlatformUser ? String(req.get('x-branch-id') || '').trim() : String(req.service?.branchId || '').trim();
  if (!tenantId || !branchId) return res.status(403).json({ message: 'Verified tenant and branch context is required.' });
  const batch = await rollbackImportBatch({
    batchId: req.params.batchId,
    tenantId,
    branchId,
    actor: req.service.userId || req.service.name
  });
  if (!batch) return res.status(404).json({ message: 'Import batch was not found.' });
  return res.json({ success: true, batchId: batch.batchId, status: batch.status, revertedAt: batch.revertedAt || null });
}));

router.post('/imports/:jobId/retry', requireServiceScope('inventory.import'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.jobId)) return res.status(404).json({ message: 'Import job was not found.' });
  const isPlatformUser = req.service?.isPlatformUser === true;
  const tenantId = isPlatformUser ? String(req.get('x-tenant-id') || '').trim() : req.service?.tenantId;
  const branchId = isPlatformUser ? String(req.get('x-branch-id') || '').trim() : req.service?.branchId;
  if (!isPlatformUser && (!tenantId || !branchId)) return res.status(403).json({ message: 'Verified tenant and branch context is required.' });
  const job = await retryImportJob(
    req.params.jobId,
    req.service.userId || req.service.name,
    req.get('idempotency-key'),
    tenantId || null,
    branchId || null
  );
  if (!job) return res.status(404).json({ message: 'Import job was not found.' });
  return res.status(202).json({ jobId: String(job._id), status: job.status });
}));

export default router;
