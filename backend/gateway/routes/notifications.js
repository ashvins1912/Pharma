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

router.get('/', authenticateUser, async (req, res, next) => {
  try {
    const userRole = req.user?.app_metadata?.role || req.user?.role || 'customer';
    const isSuperAdmin = isPlatformSuperAdmin(userRole);
    const list = await notificationService.getUserNotifications(req.user?.sub || req.context.userId, {
        tenantId: isSuperAdmin ? null : (req.context?.tenantId || req.user?.app_metadata?.tenantId || null),
        branchId: req.context?.branchId || req.user?.branchId || req.user?.app_metadata?.branchId || null,
        isSuperAdmin
    });
    res.json({ success: true, data: list });
  } catch (error) { next(error); }
});

router.patch('/:id/read', authenticateUser, async (req, res, next) => {
  try {
    const userRole = req.user?.app_metadata?.role || req.user?.role || 'customer';
    const isSuperAdmin = isPlatformSuperAdmin(userRole);
    const updated = await notificationService.markAsRead(req.params.id, req.user?.sub || req.context.userId, {
        tenantId: isSuperAdmin ? null : (req.context?.tenantId || req.user?.app_metadata?.tenantId || null),
        branchId: req.context?.branchId || null,
        isSuperAdmin
    });
    if (!updated) return res.status(404).json({ success: false, error: { code: 'NOTIFICATION_NOT_FOUND' } });
    return res.json({ success: true, data: updated });
  } catch (error) { next(error); }
});

/**
 * GET /delivery-history
 * Returns recent delivery state transitions across branches for the caller's tenant
 */
router.get('/delivery-history', authenticateUser, async (req, res, next) => {
  try {
    const userRole = req.user?.app_metadata?.role || req.user?.role || 'customer';
    const isSuper = isPlatformSuperAdmin(userRole);
    const tenantId = isSuper ? null : (req.context?.tenantId || req.user?.app_metadata?.tenantId);
    // Branch-scoped users cannot widen the delivery-history query via a URL parameter.
    // Platform Super Admin may explicitly filter a branch; tenant-wide users see their tenant.
    const branchId = isSuper ? (req.query.branchId || null) : (req.context?.branchId || req.user?.branchId || req.user?.app_metadata?.branchId || null);

    const events = await notificationService.getDeliveryEvents(tenantId, branchId, isSuper);
    res.json({ success: true, data: events });
  } catch (error) { next(error); }
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
    const branchId = req.context?.branchId || req.user?.branchId || req.user?.app_metadata?.branchId || null;
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
        userId: req.user?.sub || req.context?.userId,
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
