import express from 'express';
import dataStore from '../dataStore.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/seed-medicines', authenticateUser, isAdmin, async (req, res) => {
    try {
        await dataStore.seedMedicines();
        return res.status(201).json({
            message: '✅ Mock pharmacy catalog with images, stock counts, and expiry dates safely seeded!'
        });
    } catch (error) {
        console.error('Test medicine seeding failed:', error);
        return res.status(500).json({
            message: 'Seeding script execution crashed.',
            error: error.message
        });
    }
});

export default router;
