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
  let cursor = '$';
  let runningPromise;

  const run = async () => {
    while (!stopped && cacheClient.enabled) {
      try {
        const result = await cacheClient.pollEvents(cursor, 5000);
        if (result?.cursor) cursor = result.cursor;
        for (const event of result?.events || []) {
          if (!event?.channel) continue;
          const payload = event.payload ?? {};
          // Never broadcast user/tenant-targeted notifications to every socket.
          if (event.userId) {
            io.to(`bell_notifications_${event.userId}`).emit(event.channel, payload);
            io.to(`rider_${event.userId}`).emit(event.channel, payload);
          } else if (event.tenantId) {
            io.to(`tenant_${event.tenantId}`).emit(event.channel, payload);
          } else {
            io.emit(event.channel, payload);
          }
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
