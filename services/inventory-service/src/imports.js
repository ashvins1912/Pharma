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
  const sku = String(valueOf(row, 'SKU', 'sku') || '').trim().toUpperCase();
  const name = String(valueOf(row, 'Medicine Name', 'name', 'Name') || '').trim();
  const price = Number(valueOf(row, 'Price', 'price'));
  const stockQuantity = Number(valueOf(row, 'Stock', 'stock', 'Quantity', 'quantity'));
  const rawExpiry = valueOf(row, 'Expiry Date', 'expiryDate');
  const expiryDate = rawExpiry === undefined || rawExpiry === '' ? null
    : rawExpiry instanceof Date ? rawExpiry : new Date(rawExpiry);
  if (!sku) return { error: 'SKU is required.', errorType: 'VALIDATION_ERROR' };
  if (!name) return { error: 'Product name is required.', errorType: 'VALIDATION_ERROR' };
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be a non-negative number.', errorType: 'VALIDATION_ERROR' };
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) {
    return { error: 'Stock must be a non-negative integer.', errorType: 'VALIDATION_ERROR' };
  }
  if (expiryDate && !Number.isFinite(expiryDate.getTime())) {
    return { error: 'Expiry date is invalid.', errorType: 'VALIDATION_ERROR' };
  }
  return {
    value: {
      sku,
      name,
      genericName: String(valueOf(row, 'Generic Name', 'genericName') || ''),
      strength: String(valueOf(row, 'Strength', 'strength') || ''),
      form: String(valueOf(row, 'Form', 'form') || ''),
      manufacturer: String(valueOf(row, 'Manufacturer', 'manufacturer', 'Brand', 'brand') || ''),
      category: String(valueOf(row, 'Category', 'category') || 'General Medicine'),
      description: String(valueOf(row, 'Description', 'description') || ''),
      imageUrl: String(valueOf(row, 'Cloudinary Image URL', 'Image URL', 'imageUrl') || ''),
      requiresPrescription: String(valueOf(row, 'Requires Prescription', 'requiresPrescription') || '').toLowerCase() === 'true',
      price,
      stockQuantity,
      batchNumber: String(valueOf(row, 'Batch Number', 'batchNumber') || ''),
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

async function saveBatch(job, batch, batchId, seenSkus) {
  const failures = [];
  const valid = [];
  const batchSkus = new Set();
  for (const record of batch) {
    const normalized = normalizeImportRow(record.originalRecord);
    if (normalized.error) {
      failures.push({
        jobId: job._id,
        batchId,
        rowNumber: record.rowNumber,
        sku: String(valueOf(record.originalRecord, 'SKU', 'sku') || ''),
        productName: String(valueOf(record.originalRecord, 'Medicine Name', 'name', 'Name') || ''),
        originalRecord: record.originalRecord,
        reason: normalized.error,
        errorType: normalized.errorType,
        retryable: false
      });
      continue;
    }
    if (seenSkus.has(normalized.value.sku) || batchSkus.has(normalized.value.sku)) {
      failures.push({
        jobId: job._id,
        batchId,
        rowNumber: record.rowNumber,
        sku: normalized.value.sku,
        productName: normalized.value.name,
        originalRecord: record.originalRecord,
        reason: 'Duplicate SKU appears more than once in this import.',
        errorType: 'DUPLICATE_ERROR',
        retryable: false
      });
      continue;
    }
    seenSkus.add(normalized.value.sku);
    batchSkus.add(normalized.value.sku);
    valid.push({ ...record, value: normalized.value });
  }

  let insertedCount = 0;
  let lastError;
  let businessFailures = [];
  let eligibleRows = [];
  if (valid.length) {
    for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          businessFailures = [];
          eligibleRows = [];
          const existingInventory = await Inventory.find({ sku: { $in: valid.map(item => item.value.sku) } })
            .select('productId sku reservedQuantity')
            .session(session)
            .lean();
          const inventoryBySku = new Map(existingInventory.map(inventory => [inventory.sku, inventory]));
          for (const item of valid) {
            const currentInventory = inventoryBySku.get(item.value.sku);
            if (Number(currentInventory?.reservedQuantity || 0) > item.value.stockQuantity) {
              businessFailures.push({
                jobId: job._id,
                batchId,
                rowNumber: item.rowNumber,
                sku: item.value.sku,
                productName: item.value.name,
                originalRecord: item.originalRecord,
                reason: 'Imported stock cannot be lower than the quantity currently reserved.',
                errorType: 'BUSINESS_RULE_ERROR',
                retryable: false
              });
            } else {
              eligibleRows.push(item);
            }
          }
          if (!eligibleRows.length) return;

          const existing = await Product.find({ sku: { $in: eligibleRows.map(item => item.value.sku) } })
            .select('_id sku')
            .session(session)
            .lean();
          const bySku = new Map(existing.map(product => [product.sku, product]));
          const productOperations = [];
          const inventoryOperations = [];
          let newCount = 0;
          for (const item of eligibleRows) {
            const { value } = item;
            const current = bySku.get(value.sku);
            const productId = current?._id || new mongoose.Types.ObjectId();
            if (!current) newCount += 1;
            productOperations.push({
              updateOne: {
                filter: { sku: value.sku },
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
                  $setOnInsert: { _id: productId, sku: value.sku, version: 0 },
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
                      productId,
                      $or: [
                        { reservedQuantity: { $lte: value.stockQuantity } },
                        { reservedQuantity: { $exists: false } }
                      ]
                    }
                  : { productId },
                update: {
                  $set: {
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
          await Product.bulkWrite(productOperations, { ordered: true, session });
          const inventoryResult = await Inventory.bulkWrite(inventoryOperations, { ordered: true, session });
          if (inventoryResult.matchedCount + inventoryResult.upsertedCount !== eligibleRows.length) {
            const conflict = new Error('Inventory changed while the import batch was being applied.');
            conflict.code = 112;
            throw conflict;
          }
          insertedCount = newCount;
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const failure = classifyImportError(error);
        if (!failure.retryable || attempt === config.maxRetries) break;
        await pause(Math.min(250 * (2 ** (attempt - 1)), 2000));
      } finally {
        await session.endSession();
      }
    }
    failures.push(...businessFailures);
    if (lastError) {
      const classification = classifyImportError(lastError);
      const failedRows = eligibleRows.length || businessFailures.length ? eligibleRows : valid;
      for (const item of failedRows) {
        failures.push({
          jobId: job._id,
          batchId,
          rowNumber: item.rowNumber,
          sku: item.value.sku,
          productName: item.value.name,
          originalRecord: item.originalRecord,
          reason: 'Could not save this record after bounded retries.',
          errorType: classification.errorType,
          retryable: classification.retryable
        });
      }
    }
  }

  if (failures.length) await ImportFailure.insertMany(failures, { ordered: false });
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
  for (let start = 0; start < rows.length; start += config.batchSize) {
    const batch = rows.slice(start, start + config.batchSize).map((originalRecord, index) => ({
      rowNumber: Number(originalRecord['Source Row Number']) || start + index + 2,
      originalRecord
    }));
    const result = await saveBatch(job, batch, `${job._id}-${Math.floor(start / config.batchSize) + 1}`, seenSkus);
    failedRecords += result.failedInBatch;
  }
  await ImportJob.updateOne({ _id: job._id }, {
    $set: {
      status: failedRecords ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
      completedAt: new Date()
    }
  });
  await Audit.create({
    actor: job.uploadedBy,
    operation: 'import.completed',
    details: { jobId: String(job._id), totalRecords: rows.length, failedRecords }
  });
}

let workerTimer;
let activeWorkers = 0;
export function startImportWorkers() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    while (activeWorkers < config.workerConcurrency) {
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
          $set: { status: 'FAILED', completedAt: new Date(), errorMessage: 'Import processing failed.' }
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

export async function createImportJob({ file, fileName, uploadedBy, idempotencyKey }) {
  await fs.mkdir(config.importStorage, { recursive: true });
  const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const destination = path.join(config.importStorage, `${randomUUID()}-${safeFileName}`);
  await fs.rename(file.path, destination);
  try {
    const job = await ImportJob.create({
      fileName: safeFileName,
      filePath: destination,
      uploadedBy,
      idempotencyKey
    });
    startImportWorkers();
    return job;
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(cleanupError => {
      console.error(JSON.stringify({
        serviceName: 'inventory-service',
        operation: 'import.cleanup',
        fileName: safeFileName,
        error: cleanupError.message
      }));
    });
    if (error.code === 11000) {
      const existing = await ImportJob.findOne({ idempotencyKey });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function getImportFailures(jobId) {
  return ImportFailure.find({ jobId }).sort({ rowNumber: 1 }).lean();
}

export async function retryImportJob(jobId, uploadedBy, requestIdempotencyKey) {
  if (typeof requestIdempotencyKey !== 'string' || !requestIdempotencyKey.trim() || requestIdempotencyKey.length > 128) {
    const error = new Error('A valid Idempotency-Key header is required to retry an import.');
    error.statusCode = 400;
    throw error;
  }
  const original = await ImportJob.findById(jobId);
  if (!original) return null;
  const retryRoot = original.parentJobId
    ? await ImportJob.findById(original.parentJobId)
    : original;
  if (!retryRoot) return null;
  const retryIdempotencyKey = `retry:${retryRoot._id}:${requestIdempotencyKey.trim()}`;
  const existingRetry = await ImportJob.findOne({ idempotencyKey: retryIdempotencyKey });
  if (existingRetry) return existingRetry;
  const failed = await ImportFailure.find({ jobId, retryable: true }).sort({ rowNumber: 1 }).lean();
  if (!failed.length) {
    const error = new Error('This import has no transient failures eligible for retry.');
    error.statusCode = 409;
    throw error;
  }
  const claimedRetry = await ImportJob.findOneAndUpdate({
    _id: retryRoot._id,
    retryCount: { $lt: config.maxRetries },
    retryKeys: { $ne: retryIdempotencyKey }
  }, {
    $inc: { retryCount: 1 },
    $addToSet: { retryKeys: retryIdempotencyKey }
  }, { new: true });
  if (!claimedRetry) {
    const repeated = await ImportJob.findOne({ idempotencyKey: retryIdempotencyKey });
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
    await fs.rm(filePath, { force: true }).catch(cleanupError => {
      console.error(JSON.stringify({
        serviceName: 'inventory-service',
        operation: 'import.retry_cleanup',
        jobId: String(jobId),
        error: cleanupError.message
      }));
    });
    if (error.code === 11000) {
      const retry = await ImportJob.findOne({ idempotencyKey: retryIdempotencyKey });
      if (retry) return retry;
    }
    await ImportJob.updateOne({ _id: retryRoot._id }, {
      $inc: { retryCount: -1 },
      $pull: { retryKeys: retryIdempotencyKey }
    }).catch(persistenceError => {
      console.error(JSON.stringify({
        serviceName: 'inventory-service',
        operation: 'import.retry_claim_cleanup',
        jobId: String(jobId),
        error: persistenceError.message
      }));
    });
    throw error;
  }
}

export function buildFailureWorkbook(failures) {
  const rows = failures.map(failure => ({
    ...failure.originalRecord,
    RowNumber: failure.rowNumber,
    FailureReason: failure.reason,
    ErrorType: failure.errorType,
    Retryable: failure.retryable
  }));
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), 'Failed Records');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
