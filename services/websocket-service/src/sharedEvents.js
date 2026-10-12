import { sharedCache } from '../../../packages/shared-cache/index.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Consumes the shared Redis stream and forwards targeted events only to their
 * corresponding rooms. Returns an async stop function for graceful shutdown.
 */
export function startSharedEventConsumer(io, {
  cacheClient = sharedCache,
  retryDelayMs = 1000,
  logger = console
} = {}) {
  let stopped = false;
  let cursor = '0-0';
  let runningPromise;

  const run = async () => {
    while (!stopped && cacheClient.enabled) {
      try {
        if (cursor === '0-0') cursor = await cacheClient.getEventCursor();
        const result = await cacheClient.pollEvents(cursor, 5000);
        const events = result?.events || [];
        for (const event of events) {
          if (!event?.channel) continue;
          const payload = event.payload ?? {};
          // Only deliver to explicit audiences. Never globally broadcast an event
          // that has no verified user, tenant, rider or order target.
          const rooms = [];
          if (event.userId) {
            rooms.push(event.channel === 'new_order_alert'
              ? `rider_${event.userId}`
              : `bell_notifications_${event.userId}`);
          }
          if (event.tenantId) rooms.push(`tenant_${event.tenantId}`);
          if (event.riderId) rooms.push(`rider_${event.riderId}`);
          if (event.channel === 'order_status_changed' && payload.orderId) {
            rooms.push(`order_tracking_${payload.orderId}`);
          }
          if (rooms.length) {
            io.to([...new Set(rooms)]).emit(event.channel, payload);
          } else {
            logger.warn('[WebSocket] Dropping shared event without an explicit audience:', event.channel);
          }
        }
        if (result?.cursor && (events.length > 0 || result.cursor !== cursor)) {
          cursor = result.cursor;
          await cacheClient.acknowledgeEvents(cursor);
        }
      } catch (error) {
        if (!stopped) logger.error('[WebSocket] Shared event consumer failed; retrying:', error.message);
        await sleep(retryDelayMs);
      }
    }
  };

  if (cacheClient.enabled) runningPromise = run();
  else logger.warn('[WebSocket] CACHE_SERVICE_URL is not configured; cross-service events are disabled.');

  return async () => {
    stopped = true;
    await runningPromise;
  };
}
