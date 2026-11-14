import express from 'express';
import dataStore from '../dataStore.js';
import { authenticateUser, isAdmin } from '../middleware/auth.js';
import { requireDisplayPermission } from '../middleware/authorization.js';

const router = express.Router();

router.get('/audit-logs', authenticateUser, requireDisplayPermission('users.read', { resourceType: 'audit_log', auditOnAllow: true }), isAdmin, (_req, res) => {
    return res.json(dataStore.getAuditLogs());
});

export default router;
