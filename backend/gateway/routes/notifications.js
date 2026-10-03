/**
 * API Gateway Notifications Routes (/api/v1/notifications)
 */
import express from 'express';
import { notificationService } from '../../services/notification-service/NotificationService.js';
import { authenticateUser } from '../../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateUser, (req, res) => {
    const list = notificationService.getUserNotifications(req.context.userId);
    res.json({ success: true, data: list });
});

router.patch('/:id/read', authenticateUser, (req, res) => {
    const updated = notificationService.markAsRead(req.params.id, req.context.userId);
    res.json({ success: true, data: updated });
});

export default router;
