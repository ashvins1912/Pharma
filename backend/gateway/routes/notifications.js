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
const TENANT_STAFF_ROLES = new Set([
    'TENANT_OWNER', 'TENANT_ADMIN', 'PHARMACY', 'PHARMACIST',
    'PHARMACY_STAFF', 'ORDER_MANAGER', 'INVENTORY_MANAGER',
    'DISPATCHER', 'BRANCH_ADMIN'
]);
const isTenantStaff = user => {
    const roles = [
        user?.role,
        ...(Array.isArray(user?.roles) ? user.roles : []),
        ...(Array.isArray(user?.app_metadata?.roles) ? user.app_metadata.roles : [])
    ].filter(Boolean).map(value => String(value).toUpperCase());
    const appRole = String(user?.app_metadata?.role || '').toUpperCase();
    return TENANT_STAFF_ROLES.has(appRole) || roles.some(role => TENANT_STAFF_ROLES.has(role));
};
const getTrustedTenantScope = (user, isSuperAdmin) => ({
    tenantId: isSuperAdmin ? null : (isTenantStaff(user) ? (user?.tenantId || user?.app_metadata?.tenantId || null) : null),
    branchId: isSuperAdmin ? null : (isTenantStaff(user) ? (user?.branchId || user?.app_metadata?.branchId || null) : null)
});

router.get('/', authenticateUser, async (req, res, next) => {
  try {
    const userRole = req.user?.app_metadata?.role || req.user?.role || 'customer';
    const isSuperAdmin = isPlatformSuperAdmin(userRole);
    const scope = getTrustedTenantScope(req.user, isSuperAdmin);
    const list = await notificationService.getUserNotifications(req.user?.sub || req.context.userId, { ...scope, isSuperAdmin });
    res.json({ success: true, data: list });
  } catch (error) { next(error); }
});

router.patch('/:id/read', authenticateUser, async (req, res, next) => {
  try {
    const userRole = req.user?.app_metadata?.role || req.user?.role || 'customer';
    const isSuperAdmin = isPlatformSuperAdmin(userRole);
    const scope = getTrustedTenantScope(req.user, isSuperAdmin);
    const updated = await notificationService.markAsRead(req.params.id, req.user?.sub || req.context.userId, { ...scope, isSuperAdmin });
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
    if (!isSuper && !isTenantStaff(req.user)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Pharmacy staff access is required for delivery history.' } });
    const scope = getTrustedTenantScope(req.user, isSuper);
    const tenantId = scope.tenantId;
    // Only platform administrators may override the branch filter from the query string.
    const branchId = isSuper ? (req.query.branchId || null) : scope.branchId;

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
    if (!isSuper && !isTenantStaff(req.user)) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Pharmacy staff access is required for delivery streaming.' } });
    const scope = getTrustedTenantScope(req.user, isSuper);
    const tenantId = scope.tenantId;
    const branchId = scope.branchId;
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
