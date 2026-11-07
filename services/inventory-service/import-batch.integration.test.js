import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import * as xlsx from 'xlsx';
import test from 'node:test';

const testMongoUri = process.env.INVENTORY_TEST_MONGO_URI;
process.env.INVENTORY_IMPORTS_ENABLED = 'true';

const [{ config }, models, imports] = await Promise.all([
  import('./src/config.js'),
  import('./src/models.js'),
  import('./src/imports.js')
]);

test('controlled import preview, chunked batch ledger and rollback restore the exact before state', {
  skip: !testMongoUri,
  timeout: 60000
}, async () => {
  const tenantId = 'test-tenant-import-' + randomUUID();
  const branchId = 'test-branch-import-' + randomUUID();
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'pharma-import-integration-'));
  const databaseName = 'pharma_inventory_import_' + randomUUID().replace(/-/g, '');
  config.importStorage = storage;
  config.batchSize = 1;
  config.maxRetries = 1;
  config.workerConcurrency = 1;
  config.importsEnabled = true;

  const workbookBuffer = rows => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), 'Inventory');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };
  const writeWorkbook = async (name, rows) => {
    const filePath = path.join(storage, name);
    await fs.writeFile(filePath, workbookBuffer(rows));
    return filePath;
  };
  const waitForJob = async jobId => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const job = await models.ImportJob.findById(jobId).lean();
      if (job && ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(job.status)) {
        const batch = await models.ImportBatch.findOne({ batchId: job.batchId }).lean();
        if (batch && ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(batch.status)) return job;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Import worker did not finish within 30 seconds.');
  };

  try {
    await mongoose.connect(testMongoUri, { dbName: databaseName, serverSelectionTimeoutMS: 10000 });
    await Promise.all([
      models.Product.init(), models.Inventory.init(), models.ImportJob.init(),
      models.ImportBatch.init(), models.ImportBatchSnapshot.init(),
      models.ImportFailure.init(), models.Audit.init()
    ]);

    const existingProduct = await models.Product.create({
      tenantId, sku: 'TEST-MED-001', name: 'Original Alpha',
      genericName: '', strength: '', form: 'TABLET', manufacturer: 'Test Supplier',
      category: 'TEST DATA', description: 'Before import', imageUrl: '',
      baseCostPrice: 5, marginTier: 'LOW', requiresPrescription: false, version: 1, active: true
    });
    await models.Inventory.create({
      tenantId, branchId, productId: existingProduct._id, sku: 'TEST-MED-001',
      stockQuantity: 4, reservedQuantity: 1, price: 10,
      batchNumber: 'TEST-LOT-A', expiryDate: new Date('2030-12-31T00:00:00.000Z')
    });

    const controlledRows = [
      {
        SKU: 'TEST-MED-001', 'Medicine Name': 'Synthetic Test Medicine Alpha',
        Category: 'IMPORT TEST DATA', Description: 'Controlled test lot A',
        Price: 12, Stock: 6, 'Base Cost Price': 6, 'Margin Tier': 'MID',
        'Expiry Date': '2030-12-31', 'Batch Number': 'TEST-LOT-A',
        'Requires Prescription': 'false', Manufacturer: 'Synthetic Test Supplier'
      },
      {
        SKU: 'TEST-MED-001', 'Medicine Name': 'Synthetic Test Medicine Alpha',
        Category: 'IMPORT TEST DATA', Description: 'Controlled test lot B',
        Price: 11, Stock: 7, 'Base Cost Price': 6, 'Margin Tier': 'MID',
        'Expiry Date': '2031-06-30', 'Batch Number': 'TEST-LOT-B',
        'Requires Prescription': 'false', Manufacturer: 'Synthetic Test Supplier'
      },
      {
        SKU: 'TEST-MED-002', 'Medicine Name': 'Synthetic Test Medicine Beta',
        Category: 'IMPORT TEST DATA', Description: 'Controlled new product',
        Price: 15, Stock: 3, 'Base Cost Price': 8, 'Margin Tier': 'LOW',
        'Expiry Date': '2030-09-30', 'Batch Number': 'TEST-LOT-C',
        'Requires Prescription': 'false', Manufacturer: 'Synthetic Test Supplier'
      }
    ];

    const filePath = await writeWorkbook('controlled-test.xlsx', controlledRows);
    const preview = await imports.previewImportFile({ filePath, tenantId, branchId });
    assert.equal(preview.rowsDetected, 3);
    assert.equal(preview.validCount, 3);
    assert.equal(preview.errorsCount, 0);
    assert.equal(preview.tenantId, tenantId);
    assert.equal(preview.branchId, branchId);

    const job = await imports.createImportJob({
      file: { path: filePath },
      fileName: 'controlled-test.xlsx',
      uploadedBy: 'controlled-test-runner',
      idempotencyKey: randomUUID(),
      tenantId,
      branchId,
      stockMode: 'REPLACE',
      previewFingerprint: preview.previewFingerprint,
      approvedPreview: preview
    });
    assert.ok(job.batchId);

    const completed = await waitForJob(job._id);
    const importFailures = await models.ImportFailure.find({ batchId: job.batchId, tenantId, branchId }).lean();
    assert.equal(completed.status, 'COMPLETED', JSON.stringify({ errorMessage: completed.errorMessage, failures: importFailures.map(row => ({ rowNumber: row.rowNumber, reason: row.reason, code: row.technicalCode })) }));

    const importedLots = await models.Inventory.find({ tenantId, branchId }).sort({ sku: 1, batchNumber: 1 }).lean();
    assert.equal(importedLots.length, 3);
    assert.equal(importedLots.find(item => item.batchNumber === 'TEST-LOT-A').stockQuantity, 6);
    assert.equal(importedLots.find(item => item.batchNumber === 'TEST-LOT-B').stockQuantity, 7);
    assert.equal(importedLots.find(item => item.batchNumber === 'TEST-LOT-C').stockQuantity, 3);

    const updatedProduct = await models.Product.findOne({ tenantId, sku: 'TEST-MED-001' }).lean();
    assert.equal(updatedProduct.name, 'Synthetic Test Medicine Alpha');
    assert.equal(updatedProduct.version, 3);
    assert.equal(await models.ImportBatchSnapshot.countDocuments({ batchId: job.batchId, tenantId, branchId }), 5);

    const reverted = await imports.rollbackImportBatch({
      batchId: job.batchId, tenantId, branchId, actor: 'controlled-test-runner'
    });
    assert.equal(reverted.status, 'REVERTED');

    const restoredLots = await models.Inventory.find({ tenantId, branchId }).lean();
    assert.equal(restoredLots.length, 1);
    assert.equal(restoredLots[0].batchNumber, 'TEST-LOT-A');
    assert.equal(restoredLots[0].stockQuantity, 4);
    assert.equal(restoredLots[0].reservedQuantity, 1);
    assert.equal(restoredLots[0].price, 10);

    const restoredProduct = await models.Product.findOne({ tenantId, sku: 'TEST-MED-001' }).lean();
    assert.equal(restoredProduct.name, 'Original Alpha');
    assert.equal(restoredProduct.version, 1);
    assert.equal(await models.Product.exists({ tenantId, sku: 'TEST-MED-002' }), null);

    assert.equal(await imports.rollbackImportBatch({
      batchId: job.batchId, tenantId: 'another-tenant', branchId, actor: 'cross-tenant-probe'
    }), null);

    const staleFilePath = await writeWorkbook('stale-preview.xlsx', [controlledRows[0]]);
    const stalePreview = await imports.previewImportFile({ filePath: staleFilePath, tenantId, branchId });
    await models.Inventory.updateOne({ tenantId, branchId, sku: 'TEST-MED-001', batchNumber: 'TEST-LOT-A' }, { $set: { stockQuantity: 5 } });
    await assert.rejects(
      imports.createImportJob({
        file: { path: staleFilePath },
        fileName: 'stale-preview.xlsx',
        uploadedBy: 'controlled-test-runner',
        idempotencyKey: randomUUID(),
        tenantId,
        branchId,
        stockMode: 'REPLACE',
        previewFingerprint: stalePreview.previewFingerprint,
        approvedPreview: stalePreview
      }),
      error => error.statusCode === 409 && error.code === 'PREVIEW_FINGERPRINT_MISMATCH'
    );
    assert.equal(await models.ImportJob.countDocuments({ tenantId, branchId }), 1);
    const unchangedAfterRejection = await models.Inventory.findOne({ tenantId, branchId, sku: 'TEST-MED-001', batchNumber: 'TEST-LOT-A' }).lean();
    assert.equal(unchangedAfterRejection.stockQuantity, 5);

    const laterRows = [{ ...controlledRows[0], Stock: 8 }];
    const laterFilePath = await writeWorkbook('later-import.xlsx', laterRows);
    const laterPreview = await imports.previewImportFile({ filePath: laterFilePath, tenantId, branchId });
    const laterJob = await imports.createImportJob({
      file: { path: laterFilePath },
      fileName: 'later-import.xlsx',
      uploadedBy: 'controlled-test-runner',
      idempotencyKey: randomUUID(),
      tenantId,
      branchId,
      stockMode: 'REPLACE',
      previewFingerprint: laterPreview.previewFingerprint,
      approvedPreview: laterPreview
    });
    assert.equal((await waitForJob(laterJob._id)).status, 'COMPLETED');
    await models.Inventory.updateOne(
      { tenantId, branchId, sku: 'TEST-MED-001', batchNumber: 'TEST-LOT-A' },
      { $set: { stockQuantity: 9 } }
    );
    await assert.rejects(
      imports.rollbackImportBatch({ batchId: laterJob.batchId, tenantId, branchId, actor: 'controlled-test-runner' }),
      error => error.statusCode === 409
    );
    const protectedStock = await models.Inventory.findOne({
      tenantId, branchId, sku: 'TEST-MED-001', batchNumber: 'TEST-LOT-A'
    }).lean();
    assert.equal(protectedStock.stockQuantity, 9);
    const protectedBatch = await models.ImportBatch.findOne({ batchId: laterJob.batchId, tenantId, branchId }).lean();
    assert.equal(protectedBatch.status, 'COMPLETED');
  } finally {
    await mongoose.disconnect().catch(() => {});
    await fs.rm(storage, { recursive: true, force: true }).catch(() => {});
  }
});
