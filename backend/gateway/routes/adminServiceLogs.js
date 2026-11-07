import express from 'express';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import ServiceLog from '../../models/ServiceLog.js';

const router = express.Router();
router.use(authenticateUser, requireSuperAdmin);

// Returns application service diagnostics only; host-provider logs (for example,
// Render platform logs) require provider credentials and are intentionally not
// represented as if they were available from this API.
router.get('/', async (req, res) => {
  try {
    const hours = Number(req.query.hours ?? 1);
    if (!Number.isInteger(hours) || hours < 1 || hours > 12) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_LOG_WINDOW',
        message: 'Choose a log window between 1 and 12 hours.'
      });
    }

    const limitValue = Number(req.query.limit ?? 200);
    if (!Number.isInteger(limitValue) || limitValue < 1) {
      return res.status(400).json({ success: false, code: 'INVALID_LIMIT', message: 'Log limit must be a positive integer.' });
    }

    const query = { createdAt: { $gte: new Date(Date.now() - hours * 60 * 60 * 1000) } };
    const service = String(req.query.service || '').trim();
    const level = String(req.query.level || '').trim().toUpperCase();
    if (service) query.service = service;
    if (level) {
      if (!['WARN', 'ERROR'].includes(level)) {
        return res.status(400).json({ success: false, code: 'INVALID_LOG_LEVEL', message: 'Choose WARN or ERROR.' });
      }
      query.level = level;
    }

    const logs = await ServiceLog.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(500, limitValue))
      .select('service level message code statusCode method path requestId createdAt')
      .lean();
    const services = await ServiceLog.distinct('service', {
      createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
    });

    return res.json({
      success: true,
      source: 'pharma-application',
      hours,
      count: logs.length,
      services: services.sort(),
      data: logs
    });
  } catch (error) {
    console.error('[ServiceLogs] Query failed:', error.message);
    return res.status(503).json({ success: false, code: 'SERVICE_LOGS_UNAVAILABLE', message: 'Application service logs are temporarily unavailable.' });
  }
});

export default router;
