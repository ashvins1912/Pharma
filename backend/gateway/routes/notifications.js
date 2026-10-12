/**
 * API Gateway Notifications Routes (/api/v1/notifications)
 * Supports user notifications and real-time delivery status push notifications
 * streaming to the Tenant Admin portal via Server-Sent Events (SSE).
 */
import express from 'express';
import { notificationService } from '../../services/notification-service/NotificationService.js';
import { authenticateUser } from '../../middleware/auth.js';
import { isPlatformSuperAdmin } from '../../shared/contracts/index.js';

const router = express.Router();

router.get('/', authenticateUser, (req, res) => {
    const list = notificationService.getUserNotifications(req.context.userId);
    res.json({ success: true, data: list });
});

router.patch('/:id/read', authenticateUser, (req, res) => {
    const updated = notificationService.markAsRead(req.params.id, req.context.userId);
    res.json({ success: true, data: updated });
});

/**
 * GET /delivery-history
 * Returns recent delivery state transitions across branches for the caller's tenant
 */
router.get('/delivery-history', authenticateUser, (req, res) => {
    const userRole = req.user?.app_metadata?.role || req.user?.role || 'customer';
    const isSuper = isPlatformSuperAdmin(userRole);
    const tenantId = isSuper ? null : (req.context?.tenantId || req.user?.app_metadata?.tenantId);
    const branchId = req.query.branchId || null;

    const events = notificationService.getDeliveryEvents(tenantId, branchId);
    res.json({ success: true, data: events });
});

/**
 * GET /delivery-stream (Server-Sent Events)
 * Streams real-time order delivery status push events directly to Tenant Admin portals
 */
router.get('/delivery-stream', authenticateUser, (req, res) => {
    // 1. Prepare SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const userRole = req.user?.app_metadata?.role || req.user?.role || 'customer';
    const isSuper = isPlatformSuperAdmin(userRole);
    const tenantId = isSuper ? null : (req.context?.tenantId || req.user?.app_metadata?.tenantId);
    const branchId = req.context?.branchId || null;
    const clientId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 2. Initial Handshake Message
    res.write(`data: ${JSON.stringify({
        type: 'CONNECTED',
        message: 'Connected to Pharmacy Real-Time Delivery Push Stream',
        tenantId,
        branchId,
        timestamp: new Date().toISOString()
    })}\n\n`);

    // 3. Register client in notification service
    notificationService.addSseClient(clientId, res, {
        tenantId,
        branchId,
        userId: req.context?.userId,
        isSuperAdmin: isSuper
    });

    // 4. Heartbeat interval to maintain active TCP connection through proxies
    const heartbeat = setInterval(() => {
        try {
            res.write(': heartbeat\n\n');
        } catch {
            clearInterval(heartbeat);
        }
    }, 25000);

    // 5. Cleanup on socket close
    req.on('close', () => {
        clearInterval(heartbeat);
        notificationService.removeSseClient(clientId);
    });
});

export default router;
