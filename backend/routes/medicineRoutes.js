const express = require('express');
const router = express.Router();
const Medicine = require('../models/Medicine');
const { authenticateUser, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const xlsx = require('xlsx');

const uploadMemory = multer({ storage: multer.memoryStorage() });

router.get('/', async (req, res) => {
    const { search, hideRx } = req.query;
    let query = {};
    if (search) query.name = { $regex: search, $options: 'i' };
    if (hideRx === 'true') query.requiresPrescription = false;
    res.json(await Medicine.find(query));
});

router.post('/upload-excel', authenticateUser, isAdmin, uploadMemory.single('excelFile'), async (req, res) => {
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames]);
        for (const row of rows) {
            await Medicine.findOneAndUpdate(
                { name: row.name.trim() },
                { brand: row.brand, composition: row.composition, price: Number(row.price), requiresPrescription: String(row.requiresPrescription).toLowerCase() === 'true', imageUrl: row.imageUrl, $inc: { quantity: Number(row.quantity) || 0 } },
                { upsert: true }
            );
        }
        res.json({ message: "Stock matrix spreadsheet rows successfully read and synchronized!" });
    } catch (e) { res.status(500).json({ message: "Excel import data stream parsing failed." }); }
});

module.exports = router;
