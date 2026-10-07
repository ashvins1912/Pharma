import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as xlsx from 'xlsx';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Audit, ImportFailure, ImportJob, Inventory, Product } from './models.js';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const valueOf = (row, ...keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
};

export function normalizeImportRow(row) {
  const rawSku = valueOf(row, 'SKU', 'sku', 'Sku', 'Product SKU', 'Barcode');
  const sku = String(rawSku !== undefined && rawSku !== null ? rawSku : '').trim().toUpperCase();

  const rawName = valueOf(row, 'Medicine Name', 'medicineName', 'name', 'Name', 'Product Name', 'productName');
  const name = String(rawName !== undefined && rawName !== null ? rawName : '').trim();

  const rawPrice = valueOf(row, 'Price', 'price', 'MRP', 'mrp', 'Selling Price', 'sellingPrice');
  const price = rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== '' ? Number(rawPrice) : NaN;

  const rawStock = valueOf(row, 'Stock', 'stock', 'Quantity', 'quantity', 'Stock Quantity', 'stockQuantity');
  const stockQuantity = rawStock !== undefined && rawStock !== null && String(rawStock).trim() !== '' ? Number(rawStock) : NaN;

  const rawBaseCost = valueOf(row, 'Base Cost Price', 'baseCostPrice', 'Cost Price', 'costPrice', 'Base Price', 'basePrice');
  const baseCostPrice = rawBaseCost !== undefined && rawBaseCost !== null && String(rawBaseCost).trim() !== ''
    ? Number(rawBaseCost)
    : null;

  const rawMarginTier = valueOf(row, 'Margin Tier', 'marginTier');
  const marginTier = rawMarginTier ? String(rawMarginTier).trim().toUpperCase() : 'LOW';

  const rawExpiry = valueOf(row, 'Expiry Date', 'expiryDate', 'Expiry', 'expiry');
  let expiryDate = null;
  if (rawExpiry !== undefined && rawExpiry !== null && rawExpiry !== '') {
    if (rawExpiry instanceof Date) {
      expiryDate = rawExpiry;
    } else if (typeof rawExpiry === 'number') {
      // Excel numeric date serial
      const parsed = xlsx.SSF ? xlsx.SSF.parse_date_code(rawExpiry) : null;
      expiryDate = parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : new Date(rawExpiry);
    } else {
      expiryDate = new Date(rawExpiry);
    }
  }

  if (!sku) {
    return { error: 'SKU is required and must not be empty.', errorType: 'VALIDATION_ERROR', field: 'SKU' };
  }
  if (!name) {
    return { error: 'Medicine name is required.', errorType: 'VALIDATION_ERROR', field: 'Medicine Name' };
  }
  if (!Number.isFinite(price) || price < 0) {
    return { error: 'Price must be a valid non-negative number.', errorType: 'VALIDATION_ERROR', field: 'Price' };
  }
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) {
    return { error: 'Stock must be a non-negative integer.', errorType: 'VALIDATION_ERROR', field: 'Stock' };
  }
  if (baseCostPrice !== null && (!Number.isFinite(baseCostPrice) || baseCostPrice < 0)) {
    return { error: 'Base cost price must be a non-negative number.', errorType: 'VALIDATION_ERROR', field: 'Base Cost Price' };
  }
  if (rawMarginTier && !['LOW', 'MID', 'HIGH'].includes(marginTier)) {
    return { error: 'Margin tier must be LOW, MID, or HIGH.', errorType: 'VALIDATION_ERROR', field: 'Margin Tier' };
  }
  if (expiryDate && !Number.isFinite(expiryDate.getTime())) {
    return { error: 'Expiry date is invalid.', errorType: 'VALIDATION_ERROR', field: 'Expiry Date' };
  }

  const rawPrescription = valueOf(row, 'Requires Prescription', 'requiresPrescription', 'Prescription Required', 'isPrescriptionRequired');
  const requiresPrescription = typeof rawPrescription === 'boolean'
    ? rawPrescription
    : String(rawPrescription || '').trim().toLowerCase() === 'true';

  return {
    value: {
      sku,
      name,
      genericName: String(valueOf(row, 'Generic Name', 'genericName') || '').trim(),
      strength: String(valueOf(row, 'Strength', 'strength') || '').trim(),
      form: String(valueOf(row, 'Form', 'form', 'Dosage Form', 'dosageForm') || '').trim(),
      manufacturer: String(valueOf(row, 'Manufacturer', 'manufacturer', 'Brand', 'brand') || 'Pharmaceutical Standard').trim(),
      category: String(valueOf(row, 'Category', 'category') || 'General Medicine').trim(),
      description: String(valueOf(row, 'Description', 'description') || '').trim(),
      imageUrl: String(valueOf(row, 'Cloudinary Image URL', 'Image URL', 'imageUrl') || '').trim(),
      requiresPrescription,
      price,
      stockQuantity,
      baseCostPrice: baseCostPrice ?? undefined,
      marginTier,
      batchNumber: String(valueOf(row, 'Batch Number', 'batchNumber', 'Batch', 'batch') || '').trim(),
      expiryDate
    }
  };
}

export const classifyImportError = error => {
  if (error?.code === 11000) return { errorType: 'DUPLICATE_ERROR', retryable: false };
  if (error?.name === 'ValidationError' || error?.code === 121) {
    return { errorType: 'VALIDATION_ERROR', retryable: false };
  }
  if (['MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongoTimeoutError'].includes(error?.name)
    || ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(error?.code)) {
    return { errorType: error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'NETWORK_ERROR', retryable: true };
  }
  if ([91, 112, 189, 251, 11600, 11602].includes(error?.code)) {
    return { errorType: 'DATABASE_ERROR', retryable: true };
  }
  return { errorType: 'DATABASE_ERROR', retryable: false };
};

async function executeBatchOperations(tenantId, branchId, eligibleRows, seenExistingProducts, seenExistingInventory, session = null) {
  const bySku = new Map(seenExistingProducts.map(p => [p.sku, p]));
  const inventoryBySku = new Map(seenExistingInventory.map(i => [i.sku, i]));

  const productOperations = [];
  const inventoryOperations = [];
  let newCount = 0;

  for (const item of eligibleRows) {
    const { value } = item;
    const currentProduct = bySku.get(value.sku);
    const productId = currentProduct?._id || new mongoose.Types.ObjectId();
    if (!currentProduct) newCount += 1;

    productOperations.push({
      updateOne: {
        filter: { tenantId, sku: value.sku },
        update: {
          $set: {
            name: value.name,
            genericName: value.genericName,
            strength: value.strength,
            form: value.form,
            manufacturer: value.manufacturer,
            category: value.category,
            description: value.description,
            imageUrl: value.imageUrl,
            requiresPrescription: value.requiresPrescription,
            active: true
          },
          $setOnInsert: { _id: productId, tenantId, sku: value.sku, version: 0 },
          $inc: { version: 1 }
        },
        upsert: true
      }
    });

    const currentInventory = inventoryBySku.get(value.sku);
    inventoryOperations.push({
      updateOne: {
        filter: currentInventory
          ? {
              tenantId,
              branchId,
              productId,
              $or: [
                { reservedQuantity: { $lte: value.stockQuantity } },
                { reservedQuantity: { $exists: false } }
              ]
            }
          : { tenantId, branchId, productId },
        update: {
          $set: {
            tenantId,
            branchId,
            productId,
            sku: value.sku,
            stockQuantity: value.stockQuantity,
            price: value.price,
            batchNumber: value.batchNumber,
            expiryDate: value.expiryDate
          },
          $setOnInsert: {
            reservedQuantity: 0,
            warehouse: 'default'
          }
        },
        upsert: !currentInventory
      }
    });
  }

  const options = session ? { ordered: true, session } : { ordered: true };
  await Product.bulkWrite(productOperations, options);
  const inventoryResult = await Inventory.bulkWrite(inventoryOperations, options);

  if (inventoryResult.matchedCount + inventoryResult.upsertedCount !== eligibleRows.length) {
    const conflict = new Error('Inventory changed while the import batch was being applied.');
    conflict.code = 112;
    throw conflict;
  }

  return { newCount };
}

async function saveBatch(job, batch, batchId, seenSkus) {
  const failures = [];
  const valid = [];
  const batchSkus = new Set();
  const tenantId = job.tenantId || 'tenant-ashvin-main';
  const branchId = job.branchId || 'branch-indore-central';

  for (const record of batch) {
    const normalized = normalizeImportRow(record.originalRecord);
    if (normalized.error) {
      failures.push({
        tenantId,
        branchId,
        jobId: job._id,
        batchId,
        rowNumber: record.rowNumber,
        sku: String(valueOf(record.originalRecord, 'SKU', 'sku', 'Sku', 'Product SKU', 'Barcode') || ''),
        productName: String(valueOf(record.originalRecord, 'Medicine Name', 'medicineName', 'name', 'Name') || ''),
        originalRecord: record.originalRecord,
        reason: normalized.error,
        errorType: normalized.errorType,
        technicalCode: normalized.field || 'VALIDATION_FAILED',
        retryable: false
      });
      continue;
    }

    if (seenSkus.has(normalized.value.sku) || batchSkus.has(normalized.value.sku)) {
      failures.push({
        tenantId,
        branchId,
        jobId: job._id,
        batchId,
        rowNumber: record.rowNumber,
        sku: normalized.value.sku,
        productName: normalized.value.name,
        originalRecord: record.originalRecord,
        reason: 'Duplicate SKU appears more than once in this import.',
        errorType: 'DUPLICATE_ERROR',
        technicalCode: 'DUPLICATE_SKU_IN_FILE',
        retryable: false
      });
      continue;
    }

    seenSkus.add(normalized.value.sku);
    batchSkus.add(normalized.value.sku);
    valid.push({ ...record, value: normalized.value });
  }

  let insertedCount = 0;
  let lastError = null;
  let businessFailures = [];
  let eligibleRows = [];

  if (valid.length) {
    const skus = valid.map(item => item.value.sku);
    for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
      let session = null;
      let transactionSupported = false;

      try {
        if (mongoose.connection.readyState === 1) {
          session = await mongoose.startSession();
          transactionSupported = session && typeof session.withTransaction === 'function';
        }
      } catch {
        session = null;
        transactionSupported = false;
      }

      try {
        const executeLogic = async (sess = null) => {
          businessFailures = [];
          eligibleRows = [];

          const invQuery = { tenantId, branchId, sku: { $in: skus } };
          const existingInventory = sess
            ? await Inventory.find(invQuery).select('productId sku reservedQuantity').session(sess).lean()
            : await Inventory.find(invQuery).select('productId sku reservedQuantity').lean();

          const inventoryBySku = new Map(existingInventory.map(inv => [inv.sku, inv]));

          for (const item of valid) {
            const current = inventoryBySku.get(item.value.sku);
            if (Number(current?.reservedQuantity || 0) > item.value.stockQuantity) {
              businessFailures.push({
                tenantId,
                branchId,
                jobId: job._id,
                batchId,
                rowNumber: item.rowNumber,
                sku: item.value.sku,
                productName: item.value.name,
                originalRecord: item.originalRecord,
                reason: 'Imported stock cannot be lower than the quantity currently reserved.',
                errorType: 'BUSINESS_RULE_ERROR',
                technicalCode: 'STOCK_BELOW_RESERVED',
                retryable: false
              });
            } else {
              eligibleRows.push(item);
            }
          }

          if (!eligibleRows.length) return { newCount: 0 };

          const prodQuery = { tenantId, sku: { $in: eligibleRows.map(i => i.value.sku) } };
          const existingProducts = sess
            ? await Product.find(prodQuery).select('_id sku').session(sess).lean()
            : await Product.find(prodQuery).select('_id sku').lean();

          return executeBatchOperations(tenantId, branchId, eligibleRows, existingProducts, existingInventory, sess);
        };

        if (transactionSupported && session) {
          try {
            await session.withTransaction(async () => {
              const res = await executeLogic(session);
              insertedCount = res.newCount;
            });
          } catch (txError) {
            // If standalone mongo doesn't support replica set transactions (code 20 or similar message)
            if (txError.code === 20 || /transaction/i.test(txError.message)) {
              const res = await executeLogic(null);
              insertedCount = res.newCount;
            } else {
              throw txError;
            }
          }
        } else {
          const res = await executeLogic(null);
          insertedCount = res.newCount;
        }

        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const failure = classifyImportError(error);
        if (!failure.retryable || attempt === config.maxRetries) break;
        await pause(Math.min(250 * (2 ** (attempt - 1)), 2000));
      } finally {
        if (session) await session.endSession().catch(() => {});
      }
    }

    failures.push(...businessFailures);

    if (lastError) {
      const classification = classifyImportError(lastError);
      const failedRows = eligibleRows.length || businessFailures.length ? eligibleRows : valid;
      for (const item of failedRows) {
        failures.push({
          tenantId,
          branchId,
          jobId: job._id,
          batchId,
          rowNumber: item.rowNumber,
          sku: item.value.sku,
          productName: item.value.name,
          originalRecord: item.originalRecord,
          reason: lastError.message || 'Could not save this record after bounded retries.',
          errorType: classification.errorType,
          technicalCode: lastError.code ? String(lastError.code) : 'DATABASE_WRITE_ERROR',
          retryable: classification.retryable
        });
      }
    }
  }

  if (failures.length) {
    await ImportFailure.insertMany(failures, { ordered: false }).catch(() => {});
  }

  const failedInBatch = failures.length;
  const successfulInBatch = lastError ? 0 : eligibleRows.length;
  await ImportJob.updateOne({ _id: job._id }, {
    $inc: {
      processedRecords: batch.length,
      successfulRecords: successfulInBatch,
      failedRecords: failedInBatch,
      insertedRecords: lastError ? 0 : insertedCount,
      updatedRecords: lastError ? 0 : Math.max(0, successfulInBatch - insertedCount)
    }
  });

  return { failedInBatch };
}

async function processJob(job) {
  const workbook = xlsx.readFile(job.filePath, { cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error('Workbook does not contain a worksheet.');
  const rows = xlsx.utils.sheet_to_json(firstSheet, { defval: '', raw: false });
  await ImportJob.updateOne({ _id: job._id }, { $set: { totalRecords: rows.length } });

  let failedRecords = 0;
  const seenSkus = new Set();
  const batchSize = config.batchSize || 250;

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize).map((originalRecord, index) => ({
      rowNumber: Number(originalRecord['Source Row Number'] || originalRecord['RowNumber'] || originalRecord['Import Row Number']) || start + index + 2,
      originalRecord
    }));
    const result = await saveBatch(job, batch, `${job._id}-${Math.floor(start / batchSize) + 1}`, seenSkus);
    failedRecords += result.failedInBatch;
  }

  await ImportJob.updateOne({ _id: job._id }, {
    $set: {
      status: failedRecords ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
      completedAt: new Date()
    }
  });

  await Audit.create({
    tenantId: job.tenantId || 'tenant-ashvin-main',
    branchId: job.branchId || 'branch-indore-central',
    actor: job.uploadedBy,
    operation: 'import.completed',
    details: { jobId: String(job._id), totalRecords: rows.length, failedRecords }
  }).catch(() => {});
}

let workerTimer;
let activeWorkers = 0;
export function startImportWorkers() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    while (activeWorkers < (config.workerConcurrency || 2)) {
      activeWorkers += 1;
      void claimAndProcess()
        .catch(error => {
          console.error(JSON.stringify({
            serviceName: 'inventory-service',
            operation: 'import.worker',
            error: error.message
          }));
        })
        .finally(() => { activeWorkers -= 1; });
    }
  }, 500);
  workerTimer.unref();
}

async function claimAndProcess() {
  let job;
  try {
    job = await ImportJob.findOneAndUpdate(
      { status: 'QUEUED' },
      { $set: { status: 'PROCESSING', startedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!job) return;
    await processJob(job);
  } catch (error) {
    if (job) {
      try {
        await ImportJob.updateOne({ _id: job._id }, {
          $set: { status: 'FAILED', completedAt: new Date(), errorMessage: error.message || 'Import processing failed.' }
        });
      } catch (persistenceError) {
        console.error(JSON.stringify({
          serviceName: 'inventory-service',
          operation: 'import.failure_persistence',
          jobId: String(job._id),
          error: persistenceError.message
        }));
      }
    }
    console.error(JSON.stringify({
      serviceName: 'inventory-service',
      operation: 'import.process',
      jobId: job ? String(job._id) : undefined,
      error: error.message
    }));
  } finally {
    if (job?.filePath) {
      await fs.rm(job.filePath, { force: true }).catch(error => {
        console.error(JSON.stringify({
          serviceName: 'inventory-service',
          operation: 'import.cleanup',
          jobId: String(job._id),
          error: error.message
        }));
      });
    }
  }
}

export async function recoverImportJobs() {
  const interruptedJobs = await ImportJob.find({ status: 'PROCESSING' }).select('_id').lean();
  if (interruptedJobs.length) {
    const jobIds = interruptedJobs.map(job => job._id);
    await ImportFailure.deleteMany({ jobId: { $in: jobIds } });
    await ImportJob.updateMany({ _id: { $in: jobIds } }, {
      $set: {
        status: 'QUEUED',
        processedRecords: 0,
        successfulRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        failedRecords: 0,
        startedAt: null,
        completedAt: null
      }
    });
  }
  startImportWorkers();
}

export async function createImportJob({
  file,
  fileName,
  uploadedBy,
  idempotencyKey,
  tenantId = 'tenant-ashvin-main',
  branchId = 'branch-indore-central'
}) {
  const normalizedKey = String(idempotencyKey || '').trim();
  const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const isConnected = mongoose.connection.readyState === 1;

  // Idempotency check with tenant isolation
  let existing = null;
  if (isConnected) {
    try {
      existing = await ImportJob.findOne({ tenantId, idempotencyKey: normalizedKey });
    } catch {
      existing = Array.from(inMemoryJobs.values()).find(j => j.tenantId === tenantId && j.idempotencyKey === normalizedKey);
    }
  } else {
    existing = Array.from(inMemoryJobs.values()).find(j => j.tenantId === tenantId && j.idempotencyKey === normalizedKey);
  }

  if (existing) {
    // If same file & branch, return existing job
    if (existing.fileName === safeFileName && existing.branchId === branchId) {
      if (file?.path) await fs.rm(file.path, { force: true }).catch(() => {});
      return existing;
    }
    // If different request with same key, conflict 409
    if (file?.path) await fs.rm(file.path, { force: true }).catch(() => {});
    const conflictError = new Error('Idempotency key has already been used for a different import.');
    conflictError.statusCode = 409;
    conflictError.status = 409;
    throw conflictError;
  }

  await fs.mkdir(config.importStorage, { recursive: true });
  const destination = path.join(config.importStorage, `${randomUUID()}-${safeFileName}`);
  await fs.rename(file.path, destination);

  try {
    let job;
    if (isConnected) {
      job = await ImportJob.create({
        tenantId,
        branchId,
        fileName: safeFileName,
        filePath: destination,
        uploadedBy,
        idempotencyKey: normalizedKey
      });
    } else {
      const generatedId = new mongoose.Types.ObjectId();
      job = {
        _id: generatedId,
        tenantId,
        branchId,
        fileName: safeFileName,
        filePath: destination,
        uploadedBy,
        idempotencyKey: normalizedKey,
        status: 'QUEUED',
        totalRecords: 0,
        processedRecords: 0,
        successfulRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        failedRecords: 0,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      inMemoryJobs.set(String(generatedId), job);
    }
    startImportWorkers();
    return job;
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => {});
    if (error.code === 11000) {
      const repeated = await ImportJob.findOne({ tenantId, idempotencyKey: normalizedKey });
      if (repeated) {
        if (repeated.fileName === safeFileName && repeated.branchId === branchId) {
          return repeated;
        }
        const conflictError = new Error('Idempotency key has already been used for a different import.');
        conflictError.statusCode = 409;
        conflictError.status = 409;
        throw conflictError;
      }
    }
    throw error;
  }
}

const inMemoryJobs = new Map();
const inMemoryFailures = new Map();

export async function findImportJob(query) {
  if (mongoose.connection.readyState === 1) {
    try {
      const found = await ImportJob.findOne(query).lean();
      if (found) return found;
    } catch {
      // Continue to in-memory check
    }
  }

  const jobId = String(query._id || '');
  const job = inMemoryJobs.get(jobId);
  if (!job) return null;
  if (query.tenantId && job.tenantId !== query.tenantId) return null;
  if (query.branchId && job.branchId !== query.branchId) return null;
  return job;
}

export async function getImportFailures(jobId, tenantId = null, branchId = null) {
  const filter = { jobId };
  if (tenantId) filter.tenantId = tenantId;
  if (branchId) filter.branchId = branchId;
  if (mongoose.connection.readyState === 1) {
    try {
      return await ImportFailure.find(filter).sort({ rowNumber: 1 }).lean();
    } catch {
      // Continue to in-memory
    }
  }
  const list = inMemoryFailures.get(String(jobId)) || [];
  return list.filter(f => (!tenantId || f.tenantId === tenantId) && (!branchId || f.branchId === branchId));
}

export async function retryImportJob(jobId, uploadedBy, requestIdempotencyKey, tenantId = null, branchId = null) {
  if (typeof requestIdempotencyKey !== 'string' || !requestIdempotencyKey.trim() || requestIdempotencyKey.length > 128) {
    const error = new Error('A valid Idempotency-Key header is required to retry an import.');
    error.statusCode = 400;
    throw error;
  }

  const jobFilter = { _id: jobId };
  if (tenantId) jobFilter.tenantId = tenantId;
  if (branchId) jobFilter.branchId = branchId;

  const original = await ImportJob.findOne(jobFilter);
  if (!original) return null;

  const retryRoot = original.parentJobId
    ? await ImportJob.findOne({ _id: original.parentJobId, tenantId: original.tenantId })
    : original;
  if (!retryRoot) return null;

  const retryIdempotencyKey = `retry:${retryRoot._id}:${requestIdempotencyKey.trim()}`;
  const existingRetry = await ImportJob.findOne({ tenantId: original.tenantId, idempotencyKey: retryIdempotencyKey });
  if (existingRetry) return existingRetry;

  const failureFilter = { jobId, retryable: true };
  if (tenantId) failureFilter.tenantId = tenantId;
  if (branchId) failureFilter.branchId = branchId;

  const failed = await ImportFailure.find(failureFilter).sort({ rowNumber: 1 }).lean();
  if (!failed.length) {
    const error = new Error('This import has no transient failures eligible for retry.');
    error.statusCode = 409;
    throw error;
  }

  const claimedRetry = await ImportJob.findOneAndUpdate({
    _id: retryRoot._id,
    tenantId: original.tenantId,
    retryCount: { $lt: config.maxRetries },
    retryKeys: { $ne: retryIdempotencyKey }
  }, {
    $inc: { retryCount: 1 },
    $addToSet: { retryKeys: retryIdempotencyKey }
  }, { new: true });

  if (!claimedRetry) {
    const repeated = await ImportJob.findOne({ tenantId: original.tenantId, idempotencyKey: retryIdempotencyKey });
    if (repeated) return repeated;
    const latest = await ImportJob.findById(retryRoot._id).select('retryCount retryKeys').lean();
    const error = new Error(latest?.retryKeys?.includes(retryIdempotencyKey)
      ? 'This retry request is already being processed.'
      : 'Maximum retry count has been reached for this import.');
    error.statusCode = 409;
    throw error;
  }

  const filePath = path.join(config.importStorage, `${randomUUID()}-retry.xlsx`);
  try {
    const workbook = xlsx.utils.book_new();
    const rows = failed.map(row => ({ ...row.originalRecord, 'Source Row Number': row.rowNumber }));
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), 'Inventory');
    await fs.mkdir(config.importStorage, { recursive: true });
    await fs.writeFile(filePath, xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

    const retry = await ImportJob.create({
      tenantId: original.tenantId,
      branchId: original.branchId,
      fileName: `${original.fileName} retry`,
      filePath,
      uploadedBy,
      idempotencyKey: retryIdempotencyKey,
      parentJobId: retryRoot._id,
      retryCount: claimedRetry.retryCount
    });
    startImportWorkers();
    return retry;
  } catch (error) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    if (error.code === 11000) {
      const retry = await ImportJob.findOne({ tenantId: original.tenantId, idempotencyKey: retryIdempotencyKey });
      if (retry) return retry;
    }
    await ImportJob.updateOne({ _id: retryRoot._id }, {
      $inc: { retryCount: -1 },
      $pull: { retryKeys: retryIdempotencyKey }
    }).catch(() => {});
    throw error;
  }
}

export function buildFailureWorkbook(failures) {
  const rows = failures.map(failure => ({
    ...failure.originalRecord,
    'Import Row Number': failure.rowNumber,
    'Failure Reason': failure.reason,
    'Error Category': failure.errorType,
    'Technical Error Code': failure.technicalCode || '',
    'Retryable': failure.retryable ? 'YES' : 'NO'
  }));
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), 'Failed Records');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
