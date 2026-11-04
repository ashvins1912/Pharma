import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import test from 'node:test';

const testMongoUri = process.env.INVENTORY_TEST_MONGO_URI;
process.env.INVENTORY_IMPORTS_ENABLED = 'true';
process.env.SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET || 'test-only-inventory-service-secret-1234567890';
process.env.INVENTORY_MONGO_URI = testMongoUri || 'mongodb://127.0.0.1:27017/pharma-staged-import-test';
process.env.INVENTORY_IMPORT_STORAGE = path.join(os.tmpdir(), 'pharma-staged-import-tests');

const [{ config }, models, stagedModels, stagedRoutes, legacyRoutes] = await Promise.all([
  import('./src/config.js'),
  import('./src/models.js'),
  import('./src/staged-import-models.js'),
  import('./src/staged-import-routes.js'),
  import('./src/routes.js')
]);

test('staged import review, edit, publish, unpublish and batch revert are isolated and reversible', {
  skip: !testMongoUri,
  timeout: 90000
}, async () => {
  const tenantId = `staged-test-tenant-${randomUUID()}`;
  const branchId = `staged-test-branch-${randomUUID()}`;
  const databaseName = `staged_import_${randomUUID().replace(/-/g, '')}`;
  const app = express();
  config.importsEnabled = true;
  await mongoose.connect(testMongoUri, { dbName: databaseName, serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    models.Product.init(), models.Inventory.init(), models.Audit.init(),
    stagedModels.StagedImportBatch.init(), stagedModels.StagedImportRow.init()
  ]);

  const token = jwt.sign({
    scope: 'inventory.import', tenantId, branchId, userRole: 'tenant_admin'
  }, config.serviceAuthSecret, {
    algorithm: 'HS256', subject: 'api-gateway',
    issuer: config.serviceJwtIssuer, audience: config.serviceJwtAudience, expiresIn: '5m'
  });
  app.use(express.json());
  app.use('/api/v1/inventory', stagedRoutes);
  app.use('/api/v1/inventory', legacyRoutes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}` };

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { SKU: 'TEST-STAGED-001', 'Medicine Name': 'Synthetic Test Medicine', Category: 'IMPORT TEST DATA', Price: 12, Stock: 6, 'Batch Number': 'TEST-LOT-A', 'Expiry Date': '2030-12-31', Manufacturer: 'Test Supplier' },
    { SKU: 'TEST-STAGED-001', 'Medicine Name': 'Synthetic Test Medicine', Category: 'IMPORT TEST DATA', Price: 13, Stock: 7, 'Batch Number': 'TEST-LOT-B', 'Expiry Date': '2031-06-30', Manufacturer: 'Test Supplier' }
  ]), 'Inventory');
  const bytes = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const upload = async (url, fingerprint, key) => {
    const form = new FormData();
    form.append('excelFile', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'staged-test.xlsx');
    if (fingerprint) {
      form.append('confirmImport', 'true');
      form.append('previewFingerprint', fingerprint);
    }
    return fetch(origin + url, { method: 'POST', headers: { ...headers, ...(key ? { 'Idempotency-Key': key } : {}) }, body: form });
  };

  try {
    const previewResponse = await upload('/api/v1/inventory/imports/preview');
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.rowsDetected, 2);
    assert.equal(preview.validCount, 2);

    const stageResponse = await upload('/api/v1/inventory/imports', preview.previewFingerprint, 'staged-test-idempotency-1');
    assert.equal(stageResponse.status, 202);
    const staged = await stageResponse.json();
    assert.equal(staged.status, 'READY');
    assert.equal(staged.totalRecords, 2);
    assert.equal(await models.Product.countDocuments({ tenantId }), 0);
    assert.equal(await models.Inventory.countDocuments({ tenantId, branchId }), 0);

    const batchListResponse = await fetch(origin + '/api/v1/inventory/imports/batches', { headers });
    assert.equal(batchListResponse.status, 200);
    const batchList = await batchListResponse.json();
    assert.equal(batchList.items[0].batchId, staged.batchId);
    assert.equal(batchList.publishEnabled, true);

    const rowsResponse = await fetch(origin + `/api/v1/inventory/imports/batches/${staged.batchId}/rows`, { headers });
    assert.equal(rowsResponse.status, 200);
    const rowsPayload = await rowsResponse.json();
    assert.equal(rowsPayload.items.length, 2);
    assert.ok(rowsPayload.items.every(row => row.status === 'READY'));

    const first = rowsPayload.items[0];
    const editResponse = await fetch(origin + `/api/v1/inventory/imports/batches/${staged.batchId}/rows/${encodeURIComponent(first.rowId)}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 14, stockQuantity: 8 })
    });
    assert.equal(editResponse.status, 200);
    const edited = await editResponse.json();
    assert.equal(edited.item.normalized.price, 14);
    assert.equal(edited.item.normalized.stockQuantity, 8);

    const publishOne = await fetch(origin + `/api/v1/inventory/imports/batches/${staged.batchId}/rows/${encodeURIComponent(first.rowId)}/publish`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(publishOne.status, 200);
    assert.equal(await models.Inventory.countDocuments({ tenantId, branchId }), 1);
    assert.equal(await models.Product.countDocuments({ tenantId }), 1);

    const unpublishOne = await fetch(origin + `/api/v1/inventory/imports/batches/${staged.batchId}/unpublish`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIds: [first.rowId] })
    });
    assert.equal(unpublishOne.status, 200);
    assert.equal(await models.Inventory.countDocuments({ tenantId, branchId }), 0);
    assert.equal(await models.Product.countDocuments({ tenantId }), 0);

    const publishBoth = await fetch(origin + `/api/v1/inventory/imports/batches/${staged.batchId}/publish`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIds: rowsPayload.items.map(row => row.rowId) })
    });
    assert.equal(publishBoth.status, 200);
    assert.equal(await models.Inventory.countDocuments({ tenantId, branchId }), 2);
    assert.equal(await models.Product.countDocuments({ tenantId }), 1);

    const rollback = await fetch(origin + `/api/v1/inventory/imports/batches/${staged.batchId}/rollback`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(rollback.status, 200);
    assert.equal((await rollback.json()).status, 'REVERTED');
    assert.equal(await models.Inventory.countDocuments({ tenantId, branchId }), 0);
    assert.equal(await models.Product.countDocuments({ tenantId }), 0);

    const duplicateUpload = await upload('/api/v1/inventory/imports', preview.previewFingerprint, 'staged-test-idempotency-1');
    assert.equal(duplicateUpload.status, 202);
    assert.equal((await duplicateUpload.json()).batchId, staged.batchId);

    const crossTenantToken = jwt.sign({
      scope: 'inventory.import', tenantId: 'another-test-tenant', branchId, userRole: 'tenant_admin'
    }, config.serviceAuthSecret, {
      algorithm: 'HS256', subject: 'api-gateway',
      issuer: config.serviceJwtIssuer, audience: config.serviceJwtAudience, expiresIn: '5m'
    });
    const isolated = await fetch(origin + `/api/v1/inventory/imports/batches/${staged.batchId}`, { headers: { Authorization: `Bearer ${crossTenantToken}` } });
    assert.equal(isolated.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await fs.rm(config.importStorage, { recursive: true, force: true });
  }
});
