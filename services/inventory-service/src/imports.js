import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import xlsx from 'xlsx';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Audit, ImportBatch, ImportBatchSnapshot, ImportFailure, ImportJob, Inventory, Product } from './models.js';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function assertMongoTransactionsAvailable() {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    const error = new Error('Inventory database is unavailable.');
    error.statusCode = 503;
    throw error;
  }
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    const error = new Error('Inventory imports and rollback require MongoDB replica-set or sharded-cluster transactions.');
    error.statusCode = 503;
    error.code = 'IMPORT_TRANSACTIONS_REQUIRED';
    throw error;
  }
}

const valueOf = (row, ...keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
};

// Read both the standard import template and pharmacy stock exports whose
// title row appears before the actual column-header row.
function readImportRows(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const normalizeHeader = value => String(value ?? '').trim().toLowerCase().replace(/[.\s_/-]+/g, '');
  const headerIndex = matrix.findIndex(row => {
    const headers = row.map(normalizeHeader);
    return headers.includes('itemname') && (headers.includes('code') || headers.includes('sku'));
  });

  if (headerIndex < 0) {
    return xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false })
      .map((row, index) => ({ ...row, 'Source Row Number': index + 2 }));
  }

  const headers = matrix[headerIndex].map(value => String(value ?? '').trim());
  const get = (record, ...names) => {
    for (const name of names) {
      const key = Object.keys(record).find(candidate => normalizeHeader(candidate) === normalizeHeader(name));
      if (key && record[key] !== '' && record[key] !== null && record[key] !== undefined) return record[key];
    }
    return undefined;
  };
  const isNumber = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));

  let currentCategory = 'General Medicine';
  const records = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const cells = matrix[index] || [];
    if (!cells.some(value => value !== '' && value !== null && value !== undefined)) continue;
    const source = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? '']));
    const name = String(get(source, 'Item Name') ?? '').trim();
    const mrp = get(source, 'MRP/Pk', 'MRP / Pk', 'MRP');
    const unitMrp = get(source, 'MRP');
    const totalQty = get(source, 'Tot.Bal.Qty', 'Tot Bal Qty', 'Total Balance Qty');
    const storeQty = get(source, 'Str.Qty', 'Store Qty');
    const godownQty = get(source, 'Gdwn.Qty', 'Godown Qty');
    const calculatedQty = isNumber(totalQty)
      ? Number(totalQty)
      : (isNumber(storeQty) ? Number(storeQty) : 0) + (isNumber(godownQty) ? Number(godownQty) : 0);

    // Retain incomplete detail rows for correction in the batch review UI.
    // Only completely blank rows are skipped; category headings still update context.
    if (!name) {
      if (Object.values(source).some(value => value !== '' && value !== null && value !== undefined)) {
        records.push({
          ...source,
          SKU: String(get(source, 'Code', 'SKU') ?? '').trim(),
          'Medicine Name': '',
          Price: isNumber(mrp) ? Number(mrp) : (isNumber(unitMrp) ? Number(unitMrp) : ''),
          Stock: calculatedQty,
          'Batch Number': String(get(source, 'Batch No', 'Batch Number') ?? '').trim(),
          'Expiry Date': get(source, 'Exp Dt', 'Expiry Date') ?? '',
          Form: String(get(source, 'Packing', 'Form') ?? '').trim(),
          Category: currentCategory,
          'Source Row Number': index + 1
        });
      }
      continue;
    }

    // Category/group headings have no batch, price or stock values.
    if (!isNumber(mrp) && !isNumber(unitMrp) && !isNumber(totalQty)) {
      currentCategory = name;
      continue;
    }
    const mapped = {
      ...source,
      SKU: String(get(source, 'Code', 'SKU') ?? '').trim(),
      'Medicine Name': name,
      Price: isNumber(mrp) ? Number(mrp) : (isNumber(unitMrp) ? Number(unitMrp) : ''),
      Stock: calculatedQty,
      'Batch Number': String(get(source, 'Batch No', 'Batch Number') ?? '').trim(),
      'Expiry Date': get(source, 'Exp Dt', 'Expiry Date') ?? '',
      Form: String(get(source, 'Packing', 'Form') ?? '').trim(),
      Category: currentCategory,
      'Source Row Number': index + 1
    };

    // A stock row must have a usable product name, price and quantity.
    // Invalid detail rows are retained so preview reports them instead of silently dropping them.
    records.push(mapped);
  }
  return records;
}

export function normalizeImportRow(row) {
  const rawSku = valueOf(row, 'SKU', 'sku', 'Sku', 'Product SKU', 'Barcode', 'Code', 'Item Code');
  const sku = String(rawSku !== undefined && rawSku !== null ? rawSku : '').trim().toUpperCase();

  const rawName = valueOf(row, 'Medicine Name', 'medicineName', 'name', 'Name', 'Product Name', 'productName', 'Item Name');
  const name = String(rawName !== undefined && rawName !== null ? rawName : '').trim();

  const rawPrice = valueOf(row, 'Price', 'price', 'MRP/Pk', 'MRP Per Pack', 'MRP', 'mrp', 'Selling Price', 'sellingPrice');
  const price = rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== '' ? Number(rawPrice) : NaN;

  const rawStock = valueOf(row, 'Stock', 'stock', 'Tot.Bal.Qty', 'Total Balance Qty', 'Total Balance Quantity', 'Quantity', 'quantity', 'Stock Quantity', 'stockQuantity');
  const stockQuantity = rawStock !== undefined && rawStock !== null && String(rawStock).trim() !== '' ? Number(rawStock) : NaN;

  const rawBaseCost = valueOf(row, 'Base Cost Price', 'baseCostPrice', 'Cost Price', 'costPrice', 'Base Price', 'basePrice');
  const baseCostPrice = rawBaseCost !== undefined && rawBaseCost !== null && String(rawBaseCost).trim() !== ''
    ? Number(rawBaseCost)
    : null;

  const rawMarginTier = valueOf(row, 'Margin Tier', 'marginTier');
  const marginTier = rawMarginTier ? String(rawMarginTier).trim().toUpperCase() : 'LOW';

  const rawExpiry = valueOf(row, 'Expiry Date', 'expiryDate', 'Expiry', 'expiry', 'Exp Dt');
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
  if (expiryDate && !Number.isFinite(expiryDate.getTime())) return { error: 'Expiry date is invalid. Use an Excel date or ISO YYYY-MM-DD.', errorType: 'VALIDATION_ERROR', field: 'Expiry Date' };
  if (expiryDate) { const d = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate()); const n = new Date(); const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); if (d < today) return { error: 'Expired medicine batches cannot be imported.', errorType: 'VALIDATION_ERROR', field: 'Expiry Date' }; }

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
      form: String(valueOf(row, 'Form', 'form', 'Dosage Form', 'dosageForm', 'Packing') || '').trim(),
      manufacturer: String(valueOf(row, 'Manufacturer', 'manufacturer', 'Brand', 'brand') || 'Pharmaceutical Standard').trim(),
      category: String(valueOf(row, 'Category', 'category') || 'General Medicine').trim(),
      description: String(valueOf(row, 'Description', 'description') || '').trim(),
      imageUrl: String(valueOf(row, 'Cloudinary Image URL', 'Image URL', 'imageUrl') || '').trim(),
      requiresPrescription,
      price,
      stockQuantity,
      baseCostPrice: baseCostPrice ?? undefined,
      marginTier,
      batchNumber: String(valueOf(row, 'Batch Number', 'batchNumber', 'Batch', 'batch', 'Batch No') || '').trim(),
      expiryDate
    }
  };
}

// Generate a tenant-unique six-character SKU when the spreadsheet omits one.
async function generateUniqueSku(productName, tenantId, reservedSkus) {
  const prefix = String(productName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 2)
    .padEnd(2, 'X');

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
    const sku = `${prefix}${suffix}`;
    if (reservedSkus.has(sku)) continue;
    const existing = await Product.exists({ tenantId, sku });
    if (!existing) {
      reservedSkus.add(sku);
      return sku;
    }
  }

  throw new Error(`Could not generate a unique SKU for "${productName}". Please retry the import.`);
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

async function executeBatchOperations(tenantId, branchId, stockMode, eligibleRows, seenExistingProducts, seenExistingInventory, session = null) {
  const bySku = new Map(seenExistingProducts.map(p => [p.sku, p]));
  const batchKey = (sku, batch = '') => JSON.stringify([sku, batch || '']);
  const inventoryByBatch = new Map(seenExistingInventory.map(i => [batchKey(i.sku, i.batchNumber), i]));

  const productOperations = [];
  const inventoryOperations = [];
  const pendingProductIds = new Map();
  let newCount = 0;

  for (const item of eligibleRows) {
    const { value } = item;
    const currentProduct = bySku.get(value.sku);
    let productId = currentProduct?._id || pendingProductIds.get(value.sku);
    if (!productId) {
      productId = new mongoose.Types.ObjectId();
      pendingProductIds.set(value.sku, productId);
      newCount += 1;
    }

    if (!productOperations.some(op => op.updateOne.filter.sku === value.sku)) productOperations.push({
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
            baseCostPrice: value.baseCostPrice,
            marginTier: value.marginTier,
            active: true,
            version: Number(currentProduct?.version || 0) + 1
          },
          $setOnInsert: { _id: productId, tenantId, sku: value.sku }
        },
        upsert: true
      }
    });

    const batchNumber = value.batchNumber || '';
    const currentInventory = inventoryByBatch.get(batchKey(value.sku, batchNumber));
    const filter = { tenantId, branchId, productId, batchNumber };
    if (stockMode === 'REPLACE') filter.$or = [{ reservedQuantity: { $lte: value.stockQuantity } }, { reservedQuantity: { $exists: false } }];
    const update = { $set: { tenantId, branchId, productId, sku: value.sku, price: value.price, batchNumber, expiryDate: value.expiryDate }, $setOnInsert: { reservedQuantity: 0, warehouse: 'default' } };
    update.$set.stockQuantity = value.stockQuantity;
    inventoryOperations.push({ updateOne: { filter, update, upsert: !currentInventory } });
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

const matchesPreviewSnapshot = (current, expected, fields) => {
  if (!current && !expected) return true;
  if (!current || !expected) return false;
  return sameFields(current, expected, fields);
};

async function saveBatch(job, batch, batchId, seenSkus) {
  const failures = [];
  const valid = [];
  const batchSkus = new Set();
  const generatedSkus = new Set();
  const tenantId = job.tenantId;
  const branchId = job.branchId;
  const stockMode = job.stockMode || 'REPLACE';

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

    if (!normalized.value.sku) {
      try {
        normalized.value.sku = await generateUniqueSku(normalized.value.name, tenantId, generatedSkus);
      } catch (error) {
        failures.push({
          tenantId,
          branchId,
          jobId: job._id,
          batchId,
          rowNumber: record.rowNumber,
          sku: '',
          productName: normalized.value.name,
          originalRecord: record.originalRecord,
          reason: error.message,
          errorType: 'DATABASE_ERROR',
          technicalCode: 'SKU_GENERATION_FAILED',
          retryable: true
        });
        continue;
      }
    }

    const importKey = JSON.stringify([normalized.value.sku, normalized.value.batchNumber || '']);
    if (seenSkus.has(importKey) || batchSkus.has(importKey)) {
      failures.push({
        tenantId,
        branchId,
        jobId: job._id,
        batchId,
        rowNumber: record.rowNumber,
        sku: normalized.value.sku,
        productName: normalized.value.name,
        originalRecord: record.originalRecord,
        reason: 'Duplicate SKU + Batch Number appears more than once in this import.',
        errorType: 'DUPLICATE_ERROR',
        technicalCode: 'DUPLICATE_SKU_BATCH_IN_FILE',
        retryable: false
      });
      continue;
    }

    seenSkus.add(importKey);
    batchSkus.add(importKey);
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
          const existingInventory = await Inventory.find(invQuery).session(sess).lean();
          const prodQuery = { tenantId, sku: { $in: skus } };
          const existingProducts = await Product.find(prodQuery).session(sess).lean();
          const inventoryByBatch = new Map(existingInventory.map(inv => [JSON.stringify([inv.sku, inv.batchNumber || '']), inv]));
          const productBySku = new Map(existingProducts.map(product => [product.sku, product]));
          const expectedInventoryByKey = new Map((job.previewInventorySnapshot || []).map(item => [JSON.stringify([item.sku, item.batchNumber || '']), item]));
          const expectedProductBySku = new Map((job.previewProductSnapshot || []).map(item => [item.sku, item]));

          for (const item of valid) {
            const key = JSON.stringify([item.value.sku, item.value.batchNumber || '']);
            const current = inventoryByBatch.get(key) || null;
            const expectedInventory = expectedInventoryByKey.get(key) || null;
            if (!matchesPreviewSnapshot(current, expectedInventory, ['stockQuantity', 'reservedQuantity', 'price', 'updatedAt'])) {
              businessFailures.push({
                tenantId, branchId, jobId: job._id, batchId, rowNumber: item.rowNumber,
                sku: item.value.sku, productName: item.value.name, originalRecord: item.originalRecord,
                reason: 'Inventory changed after preview. Preview the workbook again before importing this row.',
                errorType: 'BUSINESS_RULE_ERROR', technicalCode: 'PREVIEW_INVENTORY_CHANGED', retryable: false
              });
              continue;
            }
            const currentProduct = productBySku.get(item.value.sku) || null;
            const expectedProduct = expectedProductBySku.get(item.value.sku) || null;
            if (!matchesPreviewSnapshot(currentProduct, expectedProduct, ['version', 'updatedAt'])) {
              businessFailures.push({
                tenantId, branchId, jobId: job._id, batchId, rowNumber: item.rowNumber,
                sku: item.value.sku, productName: item.value.name, originalRecord: item.originalRecord,
                reason: 'Product catalogue changed after preview. Preview the workbook again before importing this row.',
                errorType: 'BUSINESS_RULE_ERROR', technicalCode: 'PREVIEW_PRODUCT_CHANGED', retryable: false
              });
              continue;
            }
            if (stockMode === 'REPLACE' && Number(current?.reservedQuantity || 0) > item.value.stockQuantity) {
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

          const changedSkus = new Set(eligibleRows.map(item => item.value.sku));
          const changedProductQuery = { tenantId, sku: { $in: [...changedSkus] } };
          const result = await executeBatchOperations(tenantId, branchId, stockMode, eligibleRows, existingProducts, existingInventory, sess);
          const productAfterRows = await Product.find(changedProductQuery).session(sess).lean();
          const inventoryAfterRows = await Inventory.find(invQuery).session(sess).lean();
          const productBeforeBySku = new Map(existingProducts.map(row => [row.sku, row]));
          const productAfterBySku = new Map(productAfterRows.map(row => [row.sku, row]));
          const inventoryKey = row => JSON.stringify([row.sku, row.batchNumber || '']);
          const inventoryBeforeByKey = new Map(existingInventory.map(row => [inventoryKey(row), row]));
          const inventoryAfterByKey = new Map(inventoryAfterRows.map(row => [inventoryKey(row), row]));
          const snapshotOperations = [];
          for (const sku of new Set(eligibleRows.map(row => row.value.sku))) {
            const before = productBeforeBySku.get(sku) || null;
            const after = productAfterBySku.get(sku);
            if (!after) throw new Error(`Product snapshot could not be captured for SKU ${sku}.`);
            snapshotOperations.push({
              updateOne: {
                filter: { tenantId, branchId, batchId, entityType: 'PRODUCT', entityKey: sku },
                update: {
                  $set: { after },
                  $setOnInsert: { tenantId, branchId, batchId, entityType: 'PRODUCT', entityKey: sku, before, created: !before }
                },
                upsert: true
              }
            });
          }
          for (const item of eligibleRows) {
            const key = JSON.stringify([item.value.sku, item.value.batchNumber || '']);
            const before = inventoryBeforeByKey.get(key) || null;
            const after = inventoryAfterByKey.get(key);
            if (!after) throw new Error(`Inventory snapshot could not be captured for ${key}.`);
            snapshotOperations.push({
              updateOne: {
                filter: { tenantId, branchId, batchId, entityType: 'INVENTORY', entityKey: key },
                update: {
                  $set: { after },
                  $setOnInsert: { tenantId, branchId, batchId, entityType: 'INVENTORY', entityKey: key, before, created: !before }
                },
                upsert: true
              }
            });
          }
          if (snapshotOperations.length) await ImportBatchSnapshot.bulkWrite(snapshotOperations, { ordered: true, session: sess });
          const nextInventorySnapshot = [
            ...(job.previewInventorySnapshot || []).filter(item => !changedSkus.has(item.sku)),
            ...inventoryAfterRows.filter(item => changedSkus.has(item.sku)).map(item => ({
              sku: item.sku, batchNumber: item.batchNumber || '', stockQuantity: item.stockQuantity,
              reservedQuantity: item.reservedQuantity, price: item.price, updatedAt: item.updatedAt || null
            }))
          ];
          const nextProductSnapshot = [
            ...(job.previewProductSnapshot || []).filter(item => !changedSkus.has(item.sku)),
            ...productAfterRows.map(item => ({ sku: item.sku, version: item.version, updatedAt: item.updatedAt || null }))
          ];
          await ImportJob.updateOne({ _id: job._id }, {
            $set: { previewInventorySnapshot: nextInventorySnapshot, previewProductSnapshot: nextProductSnapshot }
          }, { session: sess });
          await ImportBatch.updateOne({ batchId, tenantId, branchId }, { $inc: { appliedRecords: eligibleRows.length } }, { session: sess });
          return { ...result, previewBaseline: { inventory: nextInventorySnapshot, products: nextProductSnapshot } };
        };

        if (!transactionSupported || !session) {
          const unavailable = new Error('Inventory imports require MongoDB replica-set transactions; no writes were applied.');
          unavailable.statusCode = 503;
          unavailable.code = 'IMPORT_TRANSACTIONS_REQUIRED';
          throw unavailable;
        }
        let committedPreviewBaseline = null;
        await session.withTransaction(async () => {
          committedPreviewBaseline = null;
          const res = await executeLogic(session);
          insertedCount = res.newCount;
          committedPreviewBaseline = res.previewBaseline || null;
        });
        if (committedPreviewBaseline) {
          job.previewInventorySnapshot = committedPreviewBaseline.inventory;
          job.previewProductSnapshot = committedPreviewBaseline.products;
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
    await ImportFailure.bulkWrite(failures.map(failure => ({
      updateOne: {
        filter: { tenantId, branchId, batchId, rowNumber: failure.rowNumber },
        update: { $set: failure },
        upsert: true
      }
    })), { ordered: false }).catch(() => {});
  }
  if (!lastError && eligibleRows.length) {
    await ImportFailure.deleteMany({
      tenantId, branchId, batchId,
      rowNumber: { $in: eligibleRows.map(item => item.rowNumber) },
      retryable: true
    }).catch(() => {});
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
  const rows = readImportRows(firstSheet);
  // The upload route already verified the workbook against the approved preview.
  // Per-batch inventory/product snapshots below detect concurrent changes without
  // parsing the entire workbook and querying every SKU a second time here.
  await ImportJob.updateOne({ _id: job._id }, { $set: { totalRecords: rows.length } });

  let failedRecords = 0;
  const seenSkus = new Set();
  const batchSize = config.batchSize || 250;

  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize).map((originalRecord, index) => ({
      rowNumber: Number(originalRecord['Source Row Number'] || originalRecord['RowNumber'] || originalRecord['Import Row Number']) || start + index + 2,
      originalRecord
    }));
    const result = await saveBatch(job, batch, job.batchId, seenSkus);
    failedRecords += result.failedInBatch;
  }

  const remainingFailures = await ImportFailure.countDocuments({ batchId: job.batchId, tenantId: job.tenantId, branchId: job.branchId });
  const finalStatus = remainingFailures ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  await ImportJob.updateOne({ _id: job._id }, {
    $set: { status: finalStatus, completedAt: new Date() }
  });
  await ImportBatch.updateOne({ batchId: job.batchId, tenantId: job.tenantId, branchId: job.branchId }, {
    $set: { status: finalStatus },
    $max: { totalRecords: rows.length }
  });

  await Audit.create({
    tenantId: job.tenantId,
    branchId: job.branchId,
    actor: job.uploadedBy,
    operation: 'import.completed',
    details: { jobId: String(job._id), batchId: job.batchId, totalRecords: rows.length, failedRecords }
  }).catch(() => {});
}

let workerTimer;
let activeWorkers = 0;
export function startImportWorkers() {
  if (!config.importsEnabled || workerTimer) return;
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
    await ImportBatch.updateOne({ batchId: job.batchId, tenantId: job.tenantId, branchId: job.branchId }, { $set: { status: 'PROCESSING' } });
    await processJob(job);
  } catch (error) {
    if (job) {
      try {
        await ImportJob.updateOne({ _id: job._id }, {
          $set: { status: 'FAILED', completedAt: new Date(), errorMessage: error.message || 'Import processing failed.' }
        });
        await ImportBatch.updateOne({ batchId: job.batchId, tenantId: job.tenantId, branchId: job.branchId }, { $set: { status: 'FAILED' } });
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
    const latest = job ? await ImportJob.findById(job._id).select('status').lean().catch(() => null) : null;
    if (job?.filePath && ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(latest?.status)) {
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
  const interruptedJobs = await ImportJob.find({ status: 'PROCESSING' }).select('_id batchId tenantId branchId').lean();
  if (interruptedJobs.length) {
    const jobIds = interruptedJobs.map(job => job._id);
    const batchIds = [...new Set(interruptedJobs.map(job => job.batchId).filter(Boolean))];
    await ImportJob.updateMany({ _id: { $in: jobIds }, status: 'PROCESSING' }, {
      $set: { status: 'FAILED', completedAt: new Date(), errorMessage: 'Worker interrupted. Automatic replay was blocked; inspect or roll back this import batch.' }
    });
    await ImportBatch.updateMany({ batchId: { $in: batchIds }, status: 'PROCESSING' }, { $set: { status: 'FAILED' } });
  }
  startImportWorkers();
}

export async function createImportJob({
  file,
  fileName,
  uploadedBy,
  idempotencyKey,
  tenantId,
  branchId,
  stockMode = 'REPLACE',
  previewFingerprint,
  approvedPreview
}) {
  if (!config.importsEnabled) { const error = new Error('Inventory import writes are disabled. Enable INVENTORY_IMPORTS_ENABLED only in an isolated test environment after review.'); error.statusCode = 503; throw error; }
  if (!tenantId || !branchId) { const error = new Error('Verified tenant and branch context are required.'); error.statusCode = 403; throw error; }
  if (stockMode !== 'REPLACE') { const error = new Error('Only REPLACE stock mode is currently supported; additive imports are disabled.'); error.statusCode = 400; throw error; }
  if (!previewFingerprint) { const error = new Error('A server-generated preview fingerprint and explicit confirmation are required.'); error.statusCode = 400; throw error; }
  // The route passes the server-generated preview produced from this exact upload.
  // Reusing it avoids a second XLSX parse and duplicate full-catalogue lookups.
  if (!approvedPreview || approvedPreview.previewFingerprint !== previewFingerprint
    || approvedPreview.tenantId !== tenantId || approvedPreview.branchId !== branchId
    || !Array.isArray(approvedPreview.catalogSkus)) {
    await fs.rm(file.path, { force: true }).catch(() => {});
    const error = new Error('The approved server preview is missing or does not match this tenant and branch. Preview the workbook again.');
    error.statusCode = 409;
    error.code = 'PREVIEW_FINGERPRINT_MISMATCH';
    throw error;
  }

  // Recheck the stock/catalogue baseline without reopening or reparsing the
  // uploaded workbook. The worker also performs per-batch snapshot checks.
  const [currentInventory, currentProducts] = approvedPreview.catalogSkus.length
    ? await Promise.all([
      Inventory.find({
        tenantId, branchId, sku: { $in: approvedPreview.catalogSkus }
      }).select('sku batchNumber stockQuantity reservedQuantity price updatedAt').lean(),
      Product.find({
        tenantId, sku: { $in: approvedPreview.catalogSkus }
      }).select('sku version updatedAt').lean()
    ])
    : [[], []];
  const currentInventorySnapshot = currentInventory.map(item => ({
    sku: item.sku, batchNumber: item.batchNumber || '', stockQuantity: item.stockQuantity,
    reservedQuantity: item.reservedQuantity, price: item.price, updatedAt: item.updatedAt || null
  })).sort((left, right) => JSON.stringify([left.sku, left.batchNumber]).localeCompare(JSON.stringify([right.sku, right.batchNumber])));
  const currentProductSnapshot = currentProducts.map(item => ({
    sku: item.sku, version: item.version, updatedAt: item.updatedAt || null
  })).sort((left, right) => left.sku.localeCompare(right.sku));
  if (JSON.stringify(currentInventorySnapshot) !== JSON.stringify(approvedPreview.inventorySnapshot)
    || JSON.stringify(currentProductSnapshot) !== JSON.stringify(approvedPreview.productSnapshot)) {
    await fs.rm(file.path, { force: true }).catch(() => {});
    const error = new Error('Inventory or catalogue changed after preview. Preview the workbook again before importing.');
    error.statusCode = 409;
    error.code = 'PREVIEW_FINGERPRINT_MISMATCH';
    throw error;
  }
  const normalizedKey = String(idempotencyKey || '').trim();
  const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const isConnected = mongoose.connection.readyState === 1;
  if (!isConnected) { const error = new Error('Inventory database is unavailable; import was not queued.'); error.statusCode = 503; throw error; }
  await assertMongoTransactionsAvailable();
  const batchId = randomUUID();

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
    if (existing.fileName === safeFileName && existing.branchId === branchId && existing.previewFingerprint === previewFingerprint) {
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
      await ImportBatch.create({ batchId, tenantId, branchId, uploadedBy, status: 'QUEUED' });
      job = await ImportJob.create({
        tenantId,
        branchId,
        batchId,
        previewFingerprint,
        previewInventorySnapshot: approvedPreview.inventorySnapshot,
        previewProductSnapshot: approvedPreview.productSnapshot,
        stockMode,
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
        stockMode,
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
    await ImportBatch.deleteOne({ batchId, tenantId, branchId, status: 'QUEUED' }).catch(() => {});
    await fs.rm(destination, { force: true }).catch(() => {});
    if (error.code === 11000) {
      const repeated = await ImportJob.findOne({ tenantId, idempotencyKey: normalizedKey });
      if (repeated) {
        if (repeated.fileName === safeFileName && repeated.branchId === branchId && repeated.previewFingerprint === previewFingerprint) {
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

    const retryPreview = await previewImportFile({ filePath, tenantId: original.tenantId, branchId: original.branchId });
    const retry = await ImportJob.create({
      tenantId: original.tenantId,
      branchId: original.branchId,
      batchId: original.batchId,
      previewFingerprint: retryPreview.previewFingerprint,
      previewInventorySnapshot: retryPreview.inventorySnapshot,
      previewProductSnapshot: retryPreview.productSnapshot,
      stockMode: original.stockMode || 'REPLACE',
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


export async function previewImportFile({ filePath, tenantId, branchId }) {
  if (!tenantId || !branchId) {
    const error = new Error('Verified tenant and branch context are required for preview.');
    error.statusCode = 403;
    throw error;
  }
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    const error = new Error('Workbook does not contain a worksheet.');
    error.statusCode = 400;
    throw error;
  }
  const rows = readImportRows(sheet);
  if (!rows.length) {
    const error = new Error('Workbook contains no data rows.');
    error.statusCode = 400;
    throw error;
  }
  const normalized = rows.map((row, index) => ({ rowNumber: Number(row['Source Row Number']) || index + 2, originalRecord: row, parsed: normalizeImportRow(row) }));
  const seen = new Set();
  const valid = [];
  const errors = [];
  for (const item of normalized) {
    if (item.parsed.error) {
      errors.push({ rowNumber: item.rowNumber, sku: String(valueOf(item.originalRecord, 'SKU', 'sku', 'Sku', 'Product SKU', 'Barcode') || ''), name: String(valueOf(item.originalRecord, 'Medicine Name', 'medicineName', 'name', 'Name') || ''), errors: [item.parsed.error] });
      continue;
    }
    const value = item.parsed.value;
    const key = JSON.stringify([value.sku, value.batchNumber || '']);
    if (seen.has(key)) {
      errors.push({ rowNumber: item.rowNumber, sku: value.sku, name: value.name, errors: ['Duplicate SKU + Batch Number in workbook.'] });
      continue;
    }
    seen.add(key);
    valid.push({ ...item, value });
  }
  const skus = [...new Set(valid.map(item => item.value.sku))];
  const inventory = skus.length ? await Inventory.find({ tenantId, branchId, sku: { $in: skus } }).select('sku batchNumber stockQuantity reservedQuantity price updatedAt').lean() : [];
  const products = skus.length ? await Product.find({ tenantId, sku: { $in: skus } }).select('sku version updatedAt').lean() : [];
  const inventorySnapshot = inventory.map(item => ({ sku: item.sku, batchNumber: item.batchNumber || '', stockQuantity: item.stockQuantity, reservedQuantity: item.reservedQuantity, price: item.price, updatedAt: item.updatedAt || null }))
    .sort((a, b) => JSON.stringify([a.sku, a.batchNumber]).localeCompare(JSON.stringify([b.sku, b.batchNumber])));
  const productSnapshot = products.map(item => ({ sku: item.sku, version: item.version, updatedAt: item.updatedAt || null }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  const byBatch = new Map(inventory.map(item => [JSON.stringify([item.sku, item.batchNumber || '']), item]));
  const previewRows = valid.slice(0, 10).map(item => {
    const current = byBatch.get(JSON.stringify([item.value.sku, item.value.batchNumber || '']));
    const existingStock = Number(current?.stockQuantity || 0);
    const reservedStock = Number(current?.reservedQuantity || 0);
    return {
      ...item.originalRecord,
      'Source Row Number': item.rowNumber,
      'Existing Stock': existingStock,
      'Reserved Stock': reservedStock,
      'New Stock': item.value.stockQuantity,
      'Available After Import': Math.max(0, item.value.stockQuantity - reservedStock)
    };
  });
  for (const item of valid) {
    const current = byBatch.get(JSON.stringify([item.value.sku, item.value.batchNumber || '']));
    if (Number(current?.reservedQuantity || 0) > item.value.stockQuantity) {
      errors.push({ rowNumber: item.rowNumber, sku: item.value.sku, name: item.value.name, errors: ['New stock is below the quantity already reserved for this batch.'] });
    }
  }
  const errorRows = new Set(errors.map(error => error.rowNumber));
  const previewFingerprint = createHash('sha256').update(JSON.stringify({
    tenantId, branchId,
    rows: normalized.map(item => ({ rowNumber: item.rowNumber, parsed: item.parsed.error ? { error: item.parsed.error, field: item.parsed.field } : item.parsed.value })),
    existingInventory: inventorySnapshot,
    existingProducts: productSnapshot
  })).digest('hex');
  return {
    previewFingerprint,
    inventorySnapshot,
    productSnapshot,
    tenantId,
    branchId,
    rowsDetected: rows.length,
    validCount: rows.length - errorRows.size,
    errorsCount: errorRows.size,
    warningsCount: 0,
    errors: errors.slice(0, 100),
    previewRows,
    catalogSkus: skus,
    stockMode: 'REPLACE'
  };
}


const comparable = value => value instanceof Date ? value.toISOString()
  : value && typeof value.toHexString === 'function' ? value.toHexString()
    : value == null ? null : value;
const sameFields = (current, expected, fields) => fields.every(field => comparable(current?.[field]) === comparable(expected?.[field]));

export async function rollbackImportBatch({ batchId, tenantId, branchId, actor }) {
  if (!batchId || !tenantId || !branchId) {
    const error = new Error('Batch, tenant and branch identity are required for rollback.');
    error.statusCode = 400;
    throw error;
  }
  const batch = await ImportBatch.findOne({ batchId, tenantId, branchId });
  if (!batch) return null;
  if (batch.status === 'REVERTED') return batch;
  if (!['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(batch.status)) {
    const error = new Error('Only completed or interrupted batches can be rolled back.');
    error.statusCode = 409;
    throw error;
  }

  await assertMongoTransactionsAvailable();
  const session = await mongoose.startSession();
  if (!session || typeof session.withTransaction !== 'function') {
    await session?.endSession?.();
    const error = new Error('Safe rollback requires MongoDB replica-set transactions.');
    error.statusCode = 503;
    throw error;
  }
  try {
    await session.withTransaction(async () => {
      const snapshots = await ImportBatchSnapshot.find({ batchId, tenantId, branchId, revertedAt: null })
        .sort({ entityType: 1, entityKey: 1 }).session(session).lean();
      const inventorySnapshots = snapshots.filter(snapshot => snapshot.entityType === 'INVENTORY');
      const productSnapshots = snapshots.filter(snapshot => snapshot.entityType === 'PRODUCT');

      for (const snapshot of inventorySnapshots) {
        const expected = snapshot.after;
        const current = await Inventory.findOne({ _id: expected._id, tenantId, branchId }).session(session).lean();
        const fields = ['tenantId', 'branchId', 'productId', 'sku', 'stockQuantity', 'reservedQuantity', 'price', 'batchNumber', 'expiryDate', 'warehouse', 'updatedAt'];
        if (!current || !sameFields(current, expected, fields)) {
          const error = new Error(`Inventory ${snapshot.entityKey} changed after import; rollback was stopped to protect live orders and reservations.`);
          error.statusCode = 409;
          throw error;
        }
        if (snapshot.created) {
          const deleted = await Inventory.deleteOne({ _id: current._id, tenantId, branchId, sku: expected.sku, batchNumber: expected.batchNumber, stockQuantity: expected.stockQuantity, reservedQuantity: expected.reservedQuantity, price: expected.price, updatedAt: expected.updatedAt }).session(session);
          if (deleted.deletedCount !== 1) throw Object.assign(new Error(`Could not safely remove imported inventory ${snapshot.entityKey}.`), { statusCode: 409 });
        } else {
          await Inventory.replaceOne({ _id: current._id, tenantId, branchId, updatedAt: expected.updatedAt }, snapshot.before, { session, runValidators: true, timestamps: false });
        }
      }

      for (const snapshot of productSnapshots) {
        const expected = snapshot.after;
        const current = await Product.findOne({ _id: expected._id, tenantId }).session(session).lean();
        const fields = ['tenantId', 'sku', 'name', 'genericName', 'strength', 'form', 'manufacturer', 'category', 'description', 'imageUrl', 'baseCostPrice', 'marginTier', 'requiresPrescription', 'version', 'active', 'updatedAt'];
        if (!current || !sameFields(current, expected, fields)) {
          const error = new Error(`Product ${snapshot.entityKey} changed after import; rollback was stopped to avoid overwriting newer catalogue changes.`);
          error.statusCode = 409;
          throw error;
        }
        if (snapshot.created) {
          const referenced = await Inventory.exists({ tenantId, productId: current._id }).session(session);
          if (referenced) {
            const error = new Error(`Product ${snapshot.entityKey} is now referenced by inventory outside this batch and cannot be removed safely.`);
            error.statusCode = 409;
            throw error;
          }
          await Product.deleteOne({ _id: current._id, tenantId, version: expected.version, updatedAt: expected.updatedAt }).session(session);
        } else {
          await Product.replaceOne({ _id: current._id, tenantId, updatedAt: expected.updatedAt }, snapshot.before, { session, runValidators: true, timestamps: false });
        }
      }

      await ImportBatchSnapshot.updateMany({ batchId, tenantId, branchId, revertedAt: null }, { $set: { revertedAt: new Date() } }, { session });
      await ImportBatch.updateOne({ batchId, tenantId, branchId, status: { $in: ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'] } }, {
        $set: { status: 'REVERTED', revertedAt: new Date(), revertedBy: actor || 'unknown', rollbackReason: 'Explicit batch rollback' }
      }, { session });
    });
  } finally {
    await session.endSession().catch(() => {});
  }

  await Audit.create({ tenantId, branchId, actor: actor || 'unknown', operation: 'import.batch.reverted', details: { batchId } }).catch(() => {});
  return ImportBatch.findOne({ batchId, tenantId, branchId }).lean();
}
