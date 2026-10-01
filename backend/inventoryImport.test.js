import assert from 'node:assert/strict';
import test from 'node:test';
import * as xlsx from 'xlsx';
import {
    buildFailedInventoryWorkbook,
    normalizeInventoryImportRow,
    previewInventoryWorkbook
} from './services/InventoryImportService.js';

const createWorkbookBuffer = rows => {
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), 'Inventory');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

test('large workbook preview counts all 10,000 rows in bounded chunks', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
        SKU: `SKU-${index + 1}`,
        'Medicine Name': `Medicine ${index + 1}`,
        Price: 25 + index,
        Stock: index + 1,
        'Expiry Date': '2028-12-31'
    }));

    const preview = previewInventoryWorkbook(createWorkbookBuffer(rows));
    assert.equal(preview.rowsDetected, 10_000);
    assert.equal(preview.validCount, 10_000);
    assert.equal(preview.errorsCount, 0);
    assert.equal(preview.previewRows.length, 10);
    assert.equal(Object.hasOwn(preview, 'validRows'), false);
});

test('5,000 and 25,000 row workbooks remain chunk-previewable', () => {
    for (const count of [5_000, 25_000]) {
        const rows = Array.from({ length: count }, (_, index) => ({
            SKU: `BULK-${count}-${index}`,
            'Medicine Name': `Bulk Medicine ${index}`,
            Price: 12,
            Stock: 4,
            'Expiry Date': '2028-12-31'
        }));
        const preview = previewInventoryWorkbook(createWorkbookBuffer(rows));
        assert.equal(preview.rowsDetected, count);
        assert.equal(preview.validCount, count);
        assert.equal(preview.errorsCount, 0);
        assert.equal(preview.previewRows.length, 10);
    }
});

test('invalid records have readable validation errors and preserve original columns in failed workbook', () => {
    const invalidRow = {
        SKU: 'BAD-1',
        'Medicine Name': 'Invalid Medicine',
        Category: 'Pain',
        Price: 0,
        Stock: -5,
        'Expiry Date': 'not-a-date'
    };
    const result = normalizeInventoryImportRow(invalidRow);
    assert.equal(result.category, 'VALIDATION');
    assert.match(result.error, /price/i);

    const failedWorkbook = buildFailedInventoryWorkbook([{
        rowNumber: 17,
        original: invalidRow,
        errorReason: 'Invalid price: must be greater than 0',
        errorCategory: 'VALIDATION',
        technicalCode: ''
    }]);
    const workbook = xlsx.read(failedWorkbook, { type: 'buffer' });
    const [failedRecord] = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    assert.equal(failedRecord.SKU, invalidRow.SKU);
    assert.equal(failedRecord['Medicine Name'], invalidRow['Medicine Name']);
    assert.equal(failedRecord.Price, invalidRow.Price);
    assert.equal(failedRecord['Import Row Number'], 17);
    assert.match(failedRecord['Failure Reason'], /price/i);
    assert.equal(failedRecord['Error Category'], 'VALIDATION');
    assert.equal(Object.keys(failedRecord).includes('Technical Error Code'), true);
});

test('inventory import preserves normalized generic name, strength, and form', () => {
    const normalized = normalizeInventoryImportRow({
        SKU: 'PARA-500',
        'Medicine Name': 'Paracetamol 500mg',
        'Generic Name': 'Paracetamol',
        Strength: '500mg',
        Form: 'Tablet',
        Price: 45,
        Stock: 10,
        'Expiry Date': '2028-12-31'
    });
    assert.equal(normalized.value.genericName, 'Paracetamol');
    assert.equal(normalized.value.strength, '500mg');
    assert.equal(normalized.value.form, 'Tablet');
});

test('mixed workbook reports every invalid row while limiting preview error samples', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
        SKU: `SKU-${index + 1}`,
        'Medicine Name': `Medicine ${index + 1}`,
        Price: index < 150 ? 0 : 25,
        Stock: 10,
        'Expiry Date': '2028-12-31'
    }));

    const preview = previewInventoryWorkbook(createWorkbookBuffer(rows));
    assert.equal(preview.rowsDetected, 10_000);
    assert.equal(preview.validCount, 9_850);
    assert.equal(preview.errorsCount, 150);
    assert.equal(preview.errors.length, 100);
    assert.equal(preview.errors[0].rowNumber, 2);
});
