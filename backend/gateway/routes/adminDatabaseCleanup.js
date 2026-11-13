import express from 'express';
import mongoose from 'mongoose';
import { authenticateUser, requireSuperAdmin } from '../../middleware/auth.js';
import Notification from '../../models/Notification.js';
import NotificationDeliveryEvent from '../../models/NotificationDeliveryEvent.js';

const router = express.Router();
const RETENTION_DAYS = 90;
const cutoff = () => new Date(Date.now() - RETENTION_DAYS * 86400000);
const estimate = async (model, filter) => {
  const [count, bytes] = await Promise.all([
    model.countDocuments(filter),
    model.aggregate([{ $match: filter }, { $group: { _id: null, bytes: { $sum: { $bsonSize: '$$ROOT' } } } }])
  ]);
  return { count, estimatedBytes: bytes[0]?.bytes || 0 };
};
const plan = async () => {
  const before = cutoff();
  const notifications = { read: true, readAt: { $lt: before } };
  const events = { status: { $in: ['DELIVERED', 'SUCCESS', 'COMPLETED'] }, occurredAt: { $lt: before } };
  const [notificationStats, eventStats] = await Promise.all([
    estimate(Notification, notifications), estimate(NotificationDeliveryEvent, events)
  ]);
  return {
    retentionDays: RETENTION_DAYS,
    cutoff: before,
    collections: [
      { name: 'notifications', ...notificationStats, rule: 'Read notifications older than 90 days' },
      { name: 'notificationdeliveryevents', ...eventStats, rule: 'Delivered/successful events older than 90 days' }
    ]
  };
};
router.use(authenticateUser, requireSuperAdmin);
router.get('/status', async (_req, res) => {
  try {
    const result = await plan();
    return res.json({ success: true, service: 'backend-notifications', ...result });
  } catch (error) {
    return res.status(503).json({ success: false, service: 'backend-notifications', error: error.message, code: error.code || 'CLEANUP_STATUS_FAILED' });
  }
});
router.post('/preview', async (_req, res) => {
  try { return res.json({ success: true, service: 'backend-notifications', ...(await plan()) }); }
  catch (error) { return res.status(503).json({ success: false, service: 'backend-notifications', error: error.message, code: error.code || 'CLEANUP_PREVIEW_FAILED' }); }
});
router.post('/execute', async (req, res) => {
  if (req.body?.confirmation !== 'DELETE ELIGIBLE NOTIFICATION HISTORY') {
    return res.status(400).json({ success: false, code: 'CONFIRMATION_REQUIRED', message: 'Type the exact confirmation phrase to execute cleanup.' });
  }
  const before = cutoff();
  const filters = [
    [Notification, { read: true, readAt: { $lt: before } }],
    [NotificationDeliveryEvent, { status: { $in: ['DELIVERED', 'SUCCESS', 'COMPLETED'] }, occurredAt: { $lt: before } }]
  ];
  const results = [];
  for (const [model, filter] of filters) {
    try {
      const result = await model.deleteMany(filter);
      results.push({ collection: model.collection.collectionName, deletedCount: result.deletedCount || 0, status: 'COMPLETED' });
    } catch (error) {
      results.push({ collection: model.collection.collectionName, deletedCount: 0, status: 'FAILED', error: error.message, code: error.code || null });
    }
  }
  const failed = results.some(item => item.status === 'FAILED');
  return res.status(failed ? 207 : 200).json({
    success: !failed, service: 'backend-notifications', executedAt: new Date(),
    actor: req.user?.sub || req.user?.id || 'super-admin', results
  });
});
export default router;
