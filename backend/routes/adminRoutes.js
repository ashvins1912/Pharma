import express from 'express';
import dataStore from '../dataStore.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/audit-logs', authenticateUser, isAdmin, (_req, res) => {
    return res.json(dataStore.getAuditLogs());
});

export default router;
