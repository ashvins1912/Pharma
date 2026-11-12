import express from 'express';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import ServiceLog from '../../models/ServiceLog.js';
const router = express.Router();
router.use(authenticateUser, requireSuperAdmin);
router.get('/', async (req, res) => {
  try {
    const hours = Number(req.query.hours ?? 1);
    if (!Number.isInteger(hours) || hours < 1 || hours > 12) return res.status(400).json({ success: false, code: 'INVALID_LOG_WINDOW', message: 'Choose a log window between 1 and 12 hours.' });
    const limitValue = Number(req.query.limit ?? 200);
    if (!Number.isInteger(limitValue) || limitValue < 1) return res.status(400).json({ success: false, code: 'INVALID_LIMIT', message: 'Log limit must be a positive integer.' });
    const query = { createdAt: { $gte: new Date(Date.now() - hours * 3600000) } };
    const service = String(req.query.service || '').trim(), level = String(req.query.level || '').trim().toUpperCase();
    if (service) query.service = service;
    if (level) { if (!['WARN', 'ERROR'].includes(level)) return res.status(400).json({ success: false, code: 'INVALID_LOG_LEVEL', message: 'Choose WARN or ERROR.' }); query.level = level; }
    const [logs, services] = await Promise.all([
      ServiceLog.find(query).sort({ createdAt: -1, _id: -1 }).limit(Math.min(500, limitValue)).select('service level message code statusCode method path requestId createdAt').lean(),
      ServiceLog.distinct('service', { createdAt: { $gte: new Date(Date.now() - 12 * 3600000) } })
    ]);
    return res.json({ success: true, source: 'pharma-application', hours, count: logs.length, services: services.sort(), data: logs });
  } catch (error) {
    console.error('[ServiceLogs] Query failed:', error.message);
    return res.status(503).json({ success: false, code: 'SERVICE_LOGS_UNAVAILABLE', message: 'Application service logs are temporarily unavailable.' });
  }
});
export default router;