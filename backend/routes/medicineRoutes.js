import express from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import dataStore from '../dataStore.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';

const router = express.Router();
const uploadMemory = multer({ storage: multer.memoryStorage() });
const publicMedicine = medicine => {
    const { stockQuantity, reservedQuantity, ...visibleMedicine } = medicine;
    const availableQuantity = medicine.availableQuantity ?? medicine.stock ?? medicine.quantity ?? 0;
    return {
        ...visibleMedicine,
        availableQuantity,
        stock: availableQuantity,
        quantity: availableQuantity
    };
};

const getErrorStatus = error => error.statusCode
    || (error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500);

// Full inventory and CRUD are available only to verified administrators.
router.get('/admin/inventory', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { search, category, sort, page, limit } = req.query;
        res.json(await dataStore.getMedicines(search, false, category, sort, page, limit, true));
    } catch (error) {
        console.error('Admin inventory retrieval failed:', error);
        res.status(500).json({ message: 'Failed to retrieve admin inventory.' });
    }
});

router.post('/', authenticateUser, isAdmin, async (req, res) => {
    try {
        const medicine = await dataStore.createMedicine(req.body || {});
        res.status(201).json(medicine);
    } catch (error) {
        console.error('Medicine creation failed:', error);
        res.status(getErrorStatus(error)).json({ message: error.message || 'Failed to create medicine.' });
    }
});

router.put('/:medicineId', authenticateUser, isAdmin, async (req, res) => {
    try {
        const medicine = await dataStore.updateMedicine(req.params.medicineId, req.body || {});
        res.json(medicine);
    } catch (error) {
        console.error('Medicine update failed:', error);
        res.status(getErrorStatus(error)).json({ message: error.message || 'Failed to update medicine.' });
    }
});

router.delete('/:medicineId', authenticateUser, isAdmin, async (req, res) => {
    try {
        res.json(await dataStore.deleteMedicine(req.params.medicineId));
    } catch (error) {
        console.error('Medicine archival failed:', error);
        res.status(getErrorStatus(error)).json({ message: error.message || 'Failed to delete medicine.' });
    }
});

// Public catalog search, filter & pagination
router.get('/', async (req, res) => {
    try {
        const { search, hideRx, category, sort, page, limit, paginate } = req.query;
        const result = await dataStore.getMedicines(
            search,
            hideRx,
            category,
            sort,
            page,
            limit,
            false
        );
        const medicines = result.medicines.map(publicMedicine);

        if (paginate === 'false') {
            return res.json(medicines);
        }

        res.json({ ...result, medicines });
    } catch (err) {
        console.error("Error fetching medicines:", err);
        res.status(500).json({ message: "Failed to fetch medicines" });
    }
});

// Admin Inventory Alerts
router.get('/alerts', authenticateUser, isAdmin, async (req, res) => {
    try {
        const alerts = await dataStore.getInventoryAlerts();
        res.json(alerts);
    } catch (err) {
        console.error("Error fetching inventory alerts:", err);
        res.status(500).json({ message: "Failed to fetch alerts" });
    }
});

// Inventory merge audits
router.get('/audits', authenticateUser, isAdmin, async (req, res) => {
    try {
        res.json(dataStore.getInventoryAudits());
    } catch (err) {
        res.status(500).json({ message: "Failed to fetch audit logs" });
    }
});

// Excel Validation & Preview (Requirement 5)
router.post('/validate-import', authenticateUser, isAdmin, uploadMemory.single('excelFile'), async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ message: "No Excel file provided." });
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (rawRows.length === 0) {
            return res.status(400).json({ message: "Spreadsheet is empty." });
        }

        const errors = [];
        const warnings = [];
        const validRows = [];

        rawRows.forEach((row, index) => {
            const rowNumber = index + 2; // header is row 1
            const name = (row['Medicine Name'] || row.name || row.Name || '').toString().trim();
            const sku = (row['SKU'] || row.sku || '').toString().trim();
            const price = Number(row['Price'] || row.price);
            const stock = Number(row['Stock'] || row.stock || row.quantity || 0);
            const expiryRaw = row['Expiry Date'] || row.expiryDate;
            const imageUrl = (row['Cloudinary Image URL'] || row.imageUrl || '').toString().trim();

            const rowErrors = [];
            const rowWarnings = [];

            if (!name) rowErrors.push("Missing Medicine Name");
            if (isNaN(price) || price <= 0) rowErrors.push("Invalid Price (must be > 0)");
            if (isNaN(stock) || stock < 0) rowErrors.push("Invalid Stock count");

            if (expiryRaw) {
                const parsedExpiry = new Date(expiryRaw);
                if (isNaN(parsedExpiry.getTime())) {
                    rowErrors.push("Invalid Expiry Date format");
                } else if (parsedExpiry <= new Date()) {
                    rowWarnings.push("Medicine is already expired");
                }
            } else {
                rowWarnings.push("No expiry date provided; defaulting to +1 year");
            }

            if (imageUrl && !imageUrl.startsWith('http')) {
                rowWarnings.push("Image URL does not start with http/https");
            }

            if (rowErrors.length > 0) {
                errors.push({ rowNumber, sku: sku || 'N/A', name: name || 'Unnamed', errors: rowErrors });
            } else {
                if (rowWarnings.length > 0) {
                    warnings.push({ rowNumber, sku: sku || 'N/A', name, warnings: rowWarnings });
                }
                validRows.push(row);
            }
        });

        res.json({
            rowsDetected: rawRows.length,
            validCount: validRows.length,
            warningsCount: warnings.length,
            errorsCount: errors.length,
            errors,
            warnings,
            previewRows: validRows.slice(0, 10),
            validRows
        });
    } catch (err) {
        console.error("Workbook validation error:", err);
        res.status(500).json({ message: "Workbook validation failed: " + err.message });
    }
});

// Confirm and commit validated Excel rows (Requirement 6)
router.post('/confirm-import', authenticateUser, isAdmin, async (req, res) => {
    try {
        const { rows } = req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: "No valid rows provided for import." });
        }

        const adminId = req.user?.email || req.user?.sub || 'Admin';
        const result = await dataStore.importExcelInventory(rows, adminId);

        res.status(200).json({
            message: `Successfully processed ${result.totalRows} items (${result.importedCount} new, ${result.updatedCount} updated)`,
            ...result
        });
    } catch (err) {
        console.error("Import confirmation error:", err);
        res.status(500).json({ message: "Failed to import rows: " + err.message });
    }
});

// Direct single-step Excel upload
router.post('/upload-excel', authenticateUser, isAdmin, uploadMemory.single('excelFile'), async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ message: "No Excel file provided." });
        }
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        const adminId = req.user?.email || 'Admin';
        const result = await dataStore.importExcelInventory(rows, adminId);
        res.json({
            message: `Inventory synchronized! ${result.importedCount} new medicines added, ${result.updatedCount} existing stocks merged.`,
            result
        });
    } catch (e) {
        console.error("Direct Excel upload error:", e);
        res.status(500).json({ message: "Excel import data stream parsing failed: " + e.message });
    }
});

export default router;
