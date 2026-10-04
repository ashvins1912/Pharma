import assert from 'node:assert/strict';
import test from 'node:test';
import * as xlsx from 'xlsx';
import {
    classifyImportError,
    normalizeImportRow,
    buildFailureWorkbook
} from '../backend/inventory-service/src/imports.js';
import {
    Product,
    Inventory,
    ImportJob,
    ImportFailure
} from '../backend/inventory-service/src/models.js';

test('Bulk Import: Schema Validation & Column Alias Normalization', () => {
    // 1. Valid row with standard column headers
    const validStandard = normalizeImportRow({
        SKU: ' med-pcm-650 ',
        'Medicine Name': ' Paracetamol 650mg ',
        Price: '35.50',
        Stock: '120',
        'Base Cost Price': '25.00',
        'Margin Tier': 'MID',
        'Expiry Date': '2028-12-31',
        'Requires Prescription': 'true',
        Category: 'Analgesics'
    });

    assert.equal(validStandard.error, undefined);
    assert.equal(validStandard.value.sku, 'MED-PCM-650');
    assert.equal(validStandard.value.name, 'Paracetamol 650mg');
    assert.equal(validStandard.value.price, 35.50);
    assert.equal(validStandard.value.stockQuantity, 120);
    assert.equal(validStandard.value.baseCostPrice, 25.00);
    assert.equal(validStandard.value.marginTier, 'MID');
    assert.equal(validStandard.value.requiresPrescription, true);
    assert.equal(validStandard.value.category, 'Analgesics');

    // 2. Valid row with column aliases (Barcode, MRP, Quantity)
    const validAliases = normalizeImportRow({
        Barcode: 'med-azt-500',
        name: 'Azithromycin 500mg',
        mrp: 140,
        quantity: 30,
        expiry: '2027-06-30'
    });

    assert.equal(validAliases.error, undefined);
    assert.equal(validAliases.value.sku, 'MED-AZT-500');
    assert.equal(validAliases.value.name, 'Azithromycin 500mg');
    assert.equal(validAliases.value.price, 140);
    assert.equal(validAliases.value.stockQuantity, 30);

    // 3. Validation errors: missing SKU
    const missingSku = normalizeImportRow({ 'Medicine Name': 'Test Med', Price: 10, Stock: 5 });
    assert.equal(missingSku.errorType, 'VALIDATION_ERROR');
    assert.match(missingSku.error, /SKU is required/i);

    // 4. Validation errors: invalid Price (< 0 or NaN)
    const invalidPrice = normalizeImportRow({ SKU: 'SKU-1', 'Medicine Name': 'Test Med', Price: -5, Stock: 5 });
    assert.equal(invalidPrice.errorType, 'VALIDATION_ERROR');
    assert.match(invalidPrice.error, /price/i);

    // 5. Validation errors: non-integer or negative Stock
    const invalidStock = normalizeImportRow({ SKU: 'SKU-1', 'Medicine Name': 'Test Med', Price: 10, Stock: 5.5 });
    assert.equal(invalidStock.errorType, 'VALIDATION_ERROR');
    assert.match(invalidStock.error, /stock/i);

    // 6. Validation errors: invalid Expiry Date
    const invalidExpiry = normalizeImportRow({ SKU: 'SKU-1', 'Medicine Name': 'Test Med', Price: 10, Stock: 5, 'Expiry Date': 'not-a-valid-date' });
    assert.equal(invalidExpiry.errorType, 'VALIDATION_ERROR');
    assert.match(invalidExpiry.error, /expiry date is invalid/i);

    // 7. Validation errors: invalid Margin Tier
    const invalidMargin = normalizeImportRow({ SKU: 'SKU-1', 'Medicine Name': 'Test Med', Price: 10, Stock: 5, 'Margin Tier': 'SUPER_HIGH' });
    assert.equal(invalidMargin.errorType, 'VALIDATION_ERROR');
    assert.match(invalidMargin.error, /margin tier/i);
});

test('Bulk Import: Error Classification and Transient Failure Distinction', () => {
    // Permanent non-retryable errors
    assert.equal(classifyImportError({ code: 11000 }).retryable, false);
    assert.equal(classifyImportError({ code: 11000 }).errorType, 'DUPLICATE_ERROR');

    assert.equal(classifyImportError({ name: 'ValidationError' }).retryable, false);
    assert.equal(classifyImportError({ name: 'ValidationError' }).errorType, 'VALIDATION_ERROR');

    assert.equal(classifyImportError({ code: 121 }).retryable, false);

    // Transient retryable errors (Network, timeout, Mongo lock/write conflict)
    assert.equal(classifyImportError({ name: 'MongoNetworkTimeoutError' }).retryable, true);
    assert.equal(classifyImportError({ code: 'ETIMEDOUT' }).retryable, true);
    assert.equal(classifyImportError({ code: 'ECONNRESET' }).retryable, true);
    assert.equal(classifyImportError({ code: 112 }).retryable, true); // WriteConflict
    assert.equal(classifyImportError({ code: 91 }).retryable, true); // ShutdownInProgress
    assert.equal(classifyImportError({ code: 11600 }).retryable, true); // InterruptedAtShutdown
});

test('Bulk Import: Multi-Tenant Data Isolation in Models', () => {
    // Product Schema indexes: compound uniqueness on { tenantId: 1, sku: 1 }
    const productIndexes = Product.schema.indexes();
    const hasTenantSkuCompound = productIndexes.some(([fields, options]) => {
        return fields.tenantId === 1 && fields.sku === 1 && options?.unique === true;
    });
    assert.equal(hasTenantSkuCompound, true, 'Product schema must enforce compound uniqueness on (tenantId, sku)');

    // Verify sku alone is NOT globally unique
    const hasGlobalUniqueSku = productIndexes.some(([fields, options]) => {
        return Object.keys(fields).length === 1 && fields.sku === 1 && options?.unique === true;
    });
    assert.equal(hasGlobalUniqueSku, false, 'SKU must NOT be globally unique across all tenants');

    // Inventory Schema compound index on (tenantId, branchId, productId, batchNumber)
    const inventoryIndexes = Inventory.schema.indexes();
    const hasInventoryCompound = inventoryIndexes.some(([fields, options]) => {
        return fields.tenantId === 1 && fields.branchId === 1 && fields.productId === 1 && options?.unique === true;
    });
    assert.equal(hasInventoryCompound, true, 'Inventory schema must enforce compound uniqueness on (tenantId, branchId, productId, batchNumber)');

    // ImportJob compound unique index on (tenantId, idempotencyKey)
    const importJobIndexes = ImportJob.schema.indexes();
    const hasJobIdempotencyCompound = importJobIndexes.some(([fields, options]) => {
        return fields.tenantId === 1 && fields.idempotencyKey === 1 && options?.unique === true;
    });
    assert.equal(hasJobIdempotencyCompound, true, 'ImportJob schema must enforce compound uniqueness on (tenantId, idempotencyKey)');

    // ImportFailure index includes tenantId, branchId, jobId
    const failureIndexes = ImportFailure.schema.indexes();
    const hasFailureCompound = failureIndexes.some(([fields]) => {
        return fields.tenantId === 1 && fields.branchId === 1 && fields.jobId === 1;
    });
    assert.equal(hasFailureCompound, true, 'ImportFailure schema must index (tenantId, branchId, jobId, rowNumber)');
});

test('Bulk Import: Failure Workbook Generation preserves original columns and adds audit metadata', () => {
    const rawRecord = {
        SKU: 'MED-FAIL-01',
        'Medicine Name': 'Broken Medicine',
        Price: -10,
        Stock: 10,
        Manufacturer: 'Sample Labs'
    };

    const failures = [
        {
            rowNumber: 4,
            sku: 'MED-FAIL-01',
            productName: 'Broken Medicine',
            originalRecord: rawRecord,
            reason: 'Price must be a valid non-negative number.',
            errorType: 'VALIDATION_ERROR',
            technicalCode: 'Price',
            retryable: false
        }
    ];

    const workbookBuffer = buildFailureWorkbook(failures);
    assert.ok(workbookBuffer instanceof Buffer, 'Workbook must be a valid Buffer');

    const workbook = xlsx.read(workbookBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    assert.equal(sheetName, 'Failed Records');

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    assert.equal(rows.length, 1);

    const [row] = rows;
    assert.equal(row.SKU, 'MED-FAIL-01');
    assert.equal(row['Medicine Name'], 'Broken Medicine');
    assert.equal(row['Import Row Number'], 4);
    assert.equal(row['Failure Reason'], 'Price must be a valid non-negative number.');
    assert.equal(row['Error Category'], 'VALIDATION_ERROR');
    assert.equal(row['Technical Error Code'], 'Price');
    assert.equal(row['Retryable'], 'NO');
    assert.equal(row.Manufacturer, 'Sample Labs');
});
