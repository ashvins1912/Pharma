import mongoose from 'mongoose';
import * as xlsx from 'xlsx';
import { getIsConnected } from '../config/db.js';
import Medicine from '../models/Medicine.js';
import InventoryImportJob from '../models/InventoryImportJob.js';
import InventoryImportRow from '../models/InventoryImportRow.js';

const readPositiveInteger = (value, fallback, maximum) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

export const inventoryImportBatchSize = readPositiveInteger(
    process.env.INVENTORY_IMPORT_BATCH_SIZE,
    250,
    1000
);
export const inventoryImportConcurrency = readPositiveInteger(
    process.env.INVENTORY_IMPORT_CONCURRENCY,
    3,
    5
);
const inventoryImportJobConcurrency = readPositiveInteger(
    process.env.INVENTORY_IMPORT_JOB_CONCURRENCY,
    1,
    3
);

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: 'inventoryImportFiles'
});

const uploadBuffer = (fileName, buffer) => new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(fileName, {
        metadata: { purpose: 'inventory-import-source' }
    });
    stream.once('error', reject);
    stream.once('finish', () => resolve(stream.id));
    stream.end(buffer);
});

const downloadBuffer = fileId => new Promise((resolve, reject) => {
    const chunks = [];
    const stream = bucket().openDownloadStream(fileId);
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
});

const deleteFile = async fileId => {
    if (!fileId) return;
    try {
        await bucket().delete(fileId);
    } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 26) throw error;
    }
};

const getHeaders = (sheet, range) => {
    const headerCells = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        range: { s: { r: range.s.r, c: range.s.c }, e: { r: range.s.r, c: range.e.c } },
        blankrows: false,
        defval: ''
    })[0] || [];
    return headerCells.map((header, index) => String(header || `Column ${index + 1}`));
};

const toRows = (sheet, range, headers, startRow, endRow) => {
    const values = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        range: { s: { r: startRow, c: range.s.c }, e: { r: endRow, c: range.e.c } },
        blankrows: true,
        defval: ''
    });

    return values.map((cells, index) => {
        const original = {};
        headers.forEach((header, columnIndex) => {
            original[header] = cells[columnIndex] ?? '';
        });
        return { rowNumber: startRow + index + 1, original };
    }).filter(({ original }) => Object.values(original).some(value => value !== ''));
};

const parseNumber = value => value === '' || value == null ? NaN : Number(value);
const pick = (row, ...keys) => {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return undefined;
};

const escapedRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const literal = value => ({ $literal: value });

export const normalizeInventoryImportRow = original => {
    const name = String(pick(original, 'Medicine Name', 'name', 'Name') || '').trim();
    const sku = String(pick(original, 'SKU', 'sku') || '').trim().toUpperCase();
    const price = parseNumber(pick(original, 'Price', 'price'));
    const rawStock = pick(original, 'Stock', 'stock', 'Quantity', 'quantity');
    const stock = rawStock === undefined ? 10 : parseNumber(rawStock);
    const baseCostRaw = pick(original, 'Base Cost Price', 'baseCostPrice');
    const baseCostPrice = baseCostRaw === undefined ? price : parseNumber(baseCostRaw);
    const marginTier = String(pick(original, 'Margin Tier', 'marginTier') || 'LOW').trim().toUpperCase();
    const rawExpiry = pick(original, 'Expiry Date', 'expiryDate');
    const expiryDate = rawExpiry === undefined
        ? new Date(Date.now() + 365 * 86400000)
        : rawExpiry instanceof Date
            ? rawExpiry
            : new Date(rawExpiry);

    if (!name) return { error: 'Product name is required', category: 'VALIDATION' };
    if (!Number.isFinite(price) || price <= 0) return { error: 'Invalid price: must be greater than 0', category: 'VALIDATION' };
    if (!Number.isFinite(stock) || stock < 0) return { error: 'Invalid stock: must be a non-negative number', category: 'VALIDATION' };
    if (!Number.isFinite(baseCostPrice) || baseCostPrice < 0) return { error: 'Invalid base cost price: must be non-negative', category: 'VALIDATION' };
    if (!['LOW', 'MID', 'HIGH'].includes(marginTier)) return { error: 'Invalid margin tier: use LOW, MID, or HIGH', category: 'VALIDATION' };
    if (!Number.isFinite(expiryDate.getTime())) return { error: 'Invalid expiry date', category: 'VALIDATION' };

    const brand = String(pick(original, 'Brand', 'brand', 'Manufacturer', 'manufacturer') || 'Generic').trim();
    const manufacturer = String(pick(original, 'Manufacturer', 'manufacturer') || brand).trim();
    const rawImage = String(pick(original, 'Cloudinary Image URL', 'imageUrl') || '').trim();
    const batchNumber = String(pick(original, 'Batch Number', 'batchNumber') || 'BATCH-NEW').trim();
    const requiresPrescription = String(
        pick(original, 'Requires Prescription', 'requiresPrescription') || ''
    ).toLowerCase() === 'true';

    return {
        value: {
            sku: sku || undefined,
            name,
            brand,
            category: String(pick(original, 'Category', 'category') || 'General Medicine').trim(),
            subCategory: String(pick(original, 'Sub-category', 'SubCategory', 'subCategory') || 'Unclassified').trim(),
            description: String(pick(original, 'Description', 'description') || '').trim(),
            composition: 'Active Formulation',
            price,
            baseCostPrice,
            marginTier,
            stock,
            batchNumber,
            expiryDate,
            requiresPrescription,
            imageUrl: rawImage.startsWith('http')
                ? rawImage
                : 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&q=80',
            manufacturer
        }
    };
};

const rowOperation = ({ value, row }) => {
    const namePattern = new RegExp(`^${escapedRegex(value.name)}$`, 'i');
    const match = value.sku
        ? { $or: [{ sku: value.sku }, { name: namePattern }] }
        : { name: namePattern };
    const applicationKey = String(row._id);
    const alreadyApplied = { $in: [applicationKey, { $ifNull: ['$importDeduplicationKeys', []] }] };
    const stockExpression = field => ({
        $add: [
            { $ifNull: [field, { $ifNull: ['$stockQuantity', { $ifNull: ['$stock', { $ifNull: ['$quantity', 0] }] }] }] },
            { $cond: [alreadyApplied, 0, value.stock] }
        ]
    });
    const update = [{
        $set: {
            sku: value.sku ? { $ifNull: ['$sku', literal(value.sku)] } : '$sku',
            code: value.sku ? { $ifNull: ['$code', literal(value.sku)] } : '$code',
            name: { $ifNull: ['$name', literal(value.name)] },
            brand: literal(value.brand),
            category: literal(value.category),
            subCategory: literal(value.subCategory),
            description: literal(value.description),
            composition: literal(value.composition),
            price: value.price,
            baseCostPrice: value.baseCostPrice,
            marginTier: literal(value.marginTier),
            stockQuantity: stockExpression('$stockQuantity'),
            stock: stockExpression('$stock'),
            quantity: stockExpression('$quantity'),
            reservedQuantity: { $ifNull: ['$reservedQuantity', 0] },
            batchNumber: literal(value.batchNumber),
            expiryDate: literal(value.expiryDate),
            isPrescriptionRequired: value.requiresPrescription,
            requiresPrescription: value.requiresPrescription,
            imageUrl: literal(value.imageUrl),
            manufacturer: literal(value.manufacturer),
            isActive: { $ifNull: ['$isActive', true] },
            createdAt: { $ifNull: ['$createdAt', new Date()] },
            importDeduplicationKeys: {
                $cond: [
                    alreadyApplied,
                    { $ifNull: ['$importDeduplicationKeys', []] },
                    {
                        $slice: [
                            { $concatArrays: [{ $ifNull: ['$importDeduplicationKeys', []] }, [applicationKey]] },
                            -100
                        ]
                    }
                ]
            },
            updatedAt: new Date()
        }
    }];
    return { updateOne: { filter: match, update, upsert: true } };
};

const classifyBulkWriteError = error => {
    if (error?.code === 11000) return { reason: 'Duplicate SKU already exists in inventory', category: 'DUPLICATE' };
    if (error?.name === 'ValidationError') return { reason: 'Inventory record failed database validation', category: 'VALIDATION' };
    return { reason: 'Database constraint violation while saving this record', category: 'DATABASE' };
};

const processBatch = async (jobId, rows) => {
    const validRows = [];
    const failures = new Map();
    const duplicateSkus = new Set();
    for (const [rowIndex, row] of rows.entries()) {
        const normalized = normalizeInventoryImportRow(row.original);
        if (normalized.error) {
            failures.set(rowIndex, { reason: normalized.error, category: normalized.category });
            continue;
        }
        const sku = normalized.value.sku;
        if (sku && duplicateSkus.has(sku)) {
            failures.set(rowIndex, {
                reason: 'Duplicate SKU appears more than once in this processing batch',
                category: 'DUPLICATE'
            });
            continue;
        }
        if (sku) duplicateSkus.add(sku);
        if (!normalized.value.sku) {
            normalized.value.sku = `IMP-${String(jobId).slice(-8).toUpperCase()}-${row.rowNumber}`;
        }
        validRows.push({ row, value: normalized.value, rowIndex });
    }

    let bulkResult;
    if (validRows.length) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                bulkResult = await Medicine.bulkWrite(validRows.map(item => rowOperation(item)), {
                    ordered: false,
                    timestamps: true
                });
                break;
            } catch (error) {
                const writeErrors = error.writeErrors || error.result?.getWriteErrors?.() || [];
                if (writeErrors.length) {
                    for (const writeError of writeErrors) {
                        const failedRow = validRows[writeError.index];
                        failures.set(failedRow.rowIndex, {
                            ...classifyBulkWriteError(writeError),
                            technicalCode: String(writeError.code || '')
                        });
                    }
                    bulkResult = error.result;
                    break;
                }
                const retryable = ['MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError']
                    .includes(error.name)
                    || [6, 7, 89, 91, 189, 262].includes(error.code);
                if (!retryable || attempt === 2) throw error;
                await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
            }
        }
    }

    const operations = rows.map((row, index) => {
        const failure = failures.get(index);
        return {
            updateOne: {
                filter: { _id: row._id, jobId },
                update: {
                    $set: {
                        status: failure ? 'FAILED' : 'SUCCEEDED',
                        errorReason: failure?.reason || '',
                        errorCategory: failure?.category || '',
                        technicalCode: failure?.technicalCode || ''
                    }
                }
            }
        };
    });
    if (operations.length) await InventoryImportRow.bulkWrite(operations, { ordered: false });

    return {
        successful: rows.length - failures.size,
        failed: failures.size,
        inserted: bulkResult?.upsertedCount || 0,
        updated: bulkResult?.modifiedCount || 0
    };
};

export const createInventoryImport = async ({ fileName, buffer, adminId }) => {
    if (!getIsConnected()) throw Object.assign(new Error('Inventory imports require an active MongoDB connection.'), { statusCode: 503 });
    let inputFileId;
    let job;
    try {
        inputFileId = await uploadBuffer(fileName, buffer);
        job = await InventoryImportJob.create({
            adminId,
            fileName,
            inputFileId,
            status: 'QUEUED'
        });
        return job;
    } catch (error) {
        if (inputFileId) await deleteFile(inputFileId).catch(() => {});
        throw error;
    }
};

export const createInventoryImportFromRows = async ({ rows, fileName, adminId }) => {
    if (!getIsConnected()) throw Object.assign(new Error('Inventory imports require an active MongoDB connection.'), { statusCode: 503 });
    const job = await InventoryImportJob.create({
        adminId,
        fileName,
        status: 'QUEUED',
        totalRecords: rows.length
    });
    try {
        const seenSkus = new Set();
        for (let start = 0; start < rows.length; start += inventoryImportBatchSize) {
            const batch = rows.slice(start, start + inventoryImportBatchSize);
            const documents = batch.map((original, index) => {
                const row = {
                    jobId: job._id,
                    rowNumber: start + index + 2,
                    original,
                    status: 'PENDING'
                };
                const sku = String(pick(original, 'SKU', 'sku') || '').trim().toUpperCase();
                if (sku && seenSkus.has(sku)) {
                    row.status = 'FAILED';
                    row.errorReason = 'Duplicate SKU appears more than once in this import';
                    row.errorCategory = 'DUPLICATE';
                } else if (sku) {
                    seenSkus.add(sku);
                }
                return row;
            });
            await InventoryImportRow.insertMany(documents, { ordered: false });
        }
        enqueueInventoryImport(job._id);
        return job;
    } catch (error) {
        await InventoryImportJob.updateOne(
            { _id: job._id },
            { $set: { status: 'FAILED', errorMessage: 'Could not stage imported records.' } }
        );
        throw error;
    }
};

let activeJobs = 0;
const scheduledJobs = new Set();
const importQueue = [];

const stageWorkbook = async job => {
    const buffer = await downloadBuffer(job.inputFileId);
    const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet?.['!ref']) throw new Error('Spreadsheet is empty or could not be read.');
    const range = xlsx.utils.decode_range(sheet['!ref']);
    const headers = getHeaders(sheet, range);
    if (!headers.length) throw new Error('Spreadsheet header row is missing.');

    const dataStart = range.s.r + 1;
    const totalRows = Math.max(0, range.e.r - dataStart + 1);
    await InventoryImportJob.updateOne({ _id: job._id }, { $set: { totalRecords: totalRows } });

    const stagingOperations = [];
    const seenSkus = new Set();
    for (let start = dataStart; start <= range.e.r; start += inventoryImportBatchSize) {
        const end = Math.min(range.e.r, start + inventoryImportBatchSize - 1);
        const rows = toRows(sheet, range, headers, start, end);
        for (const row of rows) {
            const sku = String(pick(row.original, 'SKU', 'sku') || '').trim().toUpperCase();
            const duplicateSku = Boolean(sku && seenSkus.has(sku));
            if (sku && !duplicateSku) seenSkus.add(sku);
            stagingOperations.push({
                updateOne: {
                    filter: { jobId: job._id, rowNumber: row.rowNumber },
                    update: {
                        $setOnInsert: {
                            ...row,
                            jobId: job._id,
                            status: duplicateSku ? 'FAILED' : 'PENDING',
                            errorReason: duplicateSku ? 'Duplicate SKU appears more than once in this import' : '',
                            errorCategory: duplicateSku ? 'DUPLICATE' : ''
                        }
                    },
                    upsert: true
                }
            });
        }
        if (stagingOperations.length >= inventoryImportBatchSize) {
            await InventoryImportRow.bulkWrite(stagingOperations.splice(0), { ordered: false });
        }
    }
    if (stagingOperations.length) await InventoryImportRow.bulkWrite(stagingOperations, { ordered: false });
    const inputFileId = job.inputFileId;
    await InventoryImportJob.updateOne({ _id: job._id }, { $set: { inputFileId: null } });
    await deleteFile(inputFileId);
};

const processJob = async jobId => {
    const jobStartedAt = Date.now();
    const job = await InventoryImportJob.findOneAndUpdate(
        { _id: jobId, status: 'QUEUED' },
        { $set: { status: 'PROCESSING', startedAt: new Date(), errorMessage: '' } },
        { new: true }
    );
    if (!job) return;
    console.info('[InventoryImport] Started', {
        importId: String(job._id), adminId: job.adminId, fileName: job.fileName
    });

    try {
        if (job.inputFileId) await stageWorkbook(job);
        const pendingCount = await InventoryImportRow.countDocuments({ jobId, status: 'PENDING' });
        const total = await InventoryImportRow.countDocuments({ jobId });
        await InventoryImportJob.updateOne({ _id: jobId }, { $set: { totalRecords: total } });
        const totalBatches = Math.ceil(pendingCount / inventoryImportBatchSize);
        let batchNumber = 0;

        const processWorker = async () => {
            while (true) {
                const rows = await InventoryImportRow.find({ jobId, status: 'PENDING' })
                    .sort({ rowNumber: 1 })
                    .limit(inventoryImportBatchSize)
                    .lean();
                if (!rows.length) return;
                const claimed = await InventoryImportRow.updateMany(
                    { _id: { $in: rows.map(row => row._id) }, status: 'PENDING' },
                    { $set: { status: 'PROCESSING' } }
                );
                if (claimed.modifiedCount !== rows.length) continue;

                const result = await processBatch(jobId, rows);
                batchNumber += 1;
                await InventoryImportJob.updateOne(
                    { _id: jobId, status: 'PROCESSING' },
                    {
                        $inc: {
                            processedRecords: rows.length,
                            successfulRecords: result.successful,
                            failedRecords: result.failed,
                            importedCount: result.inserted,
                            updatedCount: result.updated,
                            currentBatch: 1
                        }
                    }
                );
                if (batchNumber === 1 || batchNumber % 10 === 0) {
                    console.info('[InventoryImport] Progress', {
                        importId: String(jobId),
                        batch: batchNumber,
                        totalBatches,
                        processed: rows.length,
                        successful: result.successful,
                        failed: result.failed
                    });
                }
            }
        };

        const workerResults = await Promise.allSettled(
            Array.from({ length: Math.min(inventoryImportConcurrency, Math.max(1, totalBatches)) }, processWorker)
        );
        const failedWorker = workerResults.find(result => result.status === 'rejected');
        if (failedWorker?.status === 'rejected') throw failedWorker.reason;
        const [latest, successfulRecords, failedRecords] = await Promise.all([
            InventoryImportJob.findById(jobId).lean(),
            InventoryImportRow.countDocuments({ jobId, status: 'SUCCEEDED' }),
            InventoryImportRow.countDocuments({ jobId, status: 'FAILED' })
        ]);
        await InventoryImportJob.updateOne(
            { _id: jobId, status: 'PROCESSING' },
            {
                $set: {
                    status: failedRecords > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
                    processedRecords: successfulRecords + failedRecords,
                    successfulRecords,
                    failedRecords,
                    completedAt: new Date()
                }
            }
        );
        console.info('[InventoryImport] Completed', {
            importId: String(jobId),
            total: latest.totalRecords,
            successful: successfulRecords,
            failed: failedRecords,
            durationMs: Date.now() - jobStartedAt
        });
    } catch (error) {
        console.error('[InventoryImport] Job failed', {
            importId: String(jobId),
            code: error.code || error.name,
            message: error.message,
            durationMs: Date.now() - jobStartedAt
        });
        await InventoryImportJob.updateOne(
            { _id: jobId, status: 'PROCESSING' },
            { $set: { status: 'FAILED', errorMessage: 'Import stopped due to a system error.' } }
        );
    }
};

export const enqueueInventoryImport = jobId => {
    if (scheduledJobs.has(String(jobId))) return;
    scheduledJobs.add(String(jobId));
    importQueue.push(jobId);
    const dispatch = () => {
        if (activeJobs >= inventoryImportJobConcurrency || importQueue.length === 0) return;
        const nextJobId = importQueue.shift();
        activeJobs += 1;
        setImmediate(async () => {
            try {
                await processJob(nextJobId);
            } finally {
                activeJobs -= 1;
                scheduledJobs.delete(String(nextJobId));
                dispatch();
            }
        });
        dispatch();
    };
    dispatch();
};

export const recoverInventoryImports = async () => {
    if (!getIsConnected()) return;
    const staleJobs = await InventoryImportJob.find({
        status: 'PROCESSING',
        updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
    }).select('_id').lean();
    for (const job of staleJobs) {
        await InventoryImportRow.updateMany(
            { jobId: job._id, status: 'PROCESSING' },
            { $set: { status: 'PENDING' } }
        );
        await InventoryImportJob.updateOne(
            { _id: job._id, status: 'PROCESSING' },
            { $set: { status: 'QUEUED' } }
        );
    }
    const jobs = await InventoryImportJob.find({ status: 'QUEUED' }).select('_id').lean();
    jobs.forEach(job => enqueueInventoryImport(job._id));
};

export const getInventoryImportStatus = async (jobId, adminId) => InventoryImportJob.findOne({
    _id: jobId,
    adminId
}).lean();

export const getInventoryImportFailedRows = async (jobId, adminId) => {
    const job = await InventoryImportJob.findOne({ _id: jobId, adminId }).lean();
    if (!job) return null;
    if (!['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(job.status)) {
        throw Object.assign(new Error('Failed records are available after processing completes.'), { statusCode: 409 });
    }
    const rows = await InventoryImportRow.find({ jobId, status: 'FAILED' })
        .sort({ rowNumber: 1 })
        .lean();
    return { job, rows };
};

export const retryInventoryImport = async (jobId, adminId) => {
    const job = await InventoryImportJob.findOneAndUpdate(
        { _id: jobId, adminId, status: 'FAILED' },
        {
            $set: {
                status: 'QUEUED',
                errorMessage: '',
                completedAt: null
            }
        },
        { new: true }
    );
    if (!job) return null;
    await InventoryImportRow.updateMany(
        { jobId, status: 'PROCESSING' },
        { $set: { status: 'PENDING' } }
    );
    enqueueInventoryImport(job._id);
    return job;
};

export const getInventoryImportWorkerState = () => ({ activeJobs, concurrency: inventoryImportConcurrency });

export const previewInventoryWorkbook = buffer => {
    const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet?.['!ref']) throw new Error('Spreadsheet is empty or could not be read.');
    const range = xlsx.utils.decode_range(sheet['!ref']);
    const headers = getHeaders(sheet, range);
    if (!headers.length) throw new Error('Spreadsheet header row is missing.');

    const dataStart = range.s.r + 1;
    const errors = [];
    let warningsCount = 0;
    const previewRows = [];
    let validCount = 0;
    let rowsDetected = 0;
    for (let start = dataStart; start <= range.e.r; start += inventoryImportBatchSize) {
        const end = Math.min(range.e.r, start + inventoryImportBatchSize - 1);
        const rows = toRows(sheet, range, headers, start, end);
        for (const row of rows) {
            rowsDetected += 1;
            const normalized = normalizeInventoryImportRow(row.original);
            if (normalized.error) {
                if (errors.length < 100) {
                    errors.push({
                        rowNumber: row.rowNumber,
                        sku: String(pick(row.original, 'SKU', 'sku') || 'N/A'),
                        name: String(pick(row.original, 'Medicine Name', 'name', 'Name') || 'Unnamed'),
                        errors: [normalized.error]
                    });
                }
            } else {
                validCount += 1;
                if (previewRows.length < 10) previewRows.push(row.original);
                const imageUrl = String(pick(row.original, 'Cloudinary Image URL', 'imageUrl') || '');
                if ((imageUrl && !imageUrl.startsWith('http'))
                    || pick(row.original, 'Expiry Date', 'expiryDate') === undefined) warningsCount += 1;
            }
        }
    }
    return {
        rowsDetected,
        validCount,
        warningsCount,
        errorsCount: rowsDetected - validCount,
        errors,
        previewRows
    };
};

export const buildFailedInventoryWorkbook = rows => {
    const originalHeaders = [...new Set(rows.flatMap(row => Object.keys(row.original || {})))];
    const outputRows = rows.map(row => ({
        ...Object.fromEntries(originalHeaders.map(header => [header, row.original?.[header] ?? ''])),
        'Import Row Number': row.rowNumber,
        'Failure Reason': row.errorReason,
        'Error Category': row.errorCategory,
        'Technical Error Code': row.technicalCode
    }));
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(outputRows), 'Failed Records');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
