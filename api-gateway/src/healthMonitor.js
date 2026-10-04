import { randomUUID } from 'node:crypto';

const RETRY_DELAY_MS = 250;
const MAX_ATTEMPTS = 2;

const safeFailure = (error, httpStatus = null) => {
  const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ETIMEDOUT';
  if (timedOut) return { status: 'TIMEOUT', errorType: 'TIMEOUT', errorMessage: 'Health request timed out.', httpStatus };
  if (httpStatus !== null) return { status: 'UNHEALTHY', errorType: 'HTTP_ERROR', errorMessage: `Health endpoint returned HTTP ${httpStatus}.`, httpStatus };
  return { status: 'UNREACHABLE', errorType: 'CONNECTION_ERROR', errorMessage: 'Health endpoint could not be reached.', httpStatus: null };
};

export function createHealthMonitor({
  services,
  intervalMs = 15 * 60 * 1000,
  timeoutMs = 5000,
  enabled = true,
  runOnStartup = false,
  fetchImpl = fetch,
  logger = console,
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  maxConcurrency = 4
}) {
  const statuses = new Map(services.map(service => [service.name, {
    serviceName: service.name,
    status: 'UNKNOWN',
    checkedAt: null,
    responseTimeMs: null,
    httpStatus: null,
    errorType: null,
    errorMessage: null
  }]));
  const controllers = new Set();
  let timer = null;
  let activeCycle = null;
  let stopping = false;

  const checkService = async service => {
    const startedAt = Date.now();
    const requestId = `health-${randomUUID()}`;
    let result = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !stopping; attempt += 1) {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeoutFn(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(new URL(service.healthPath, `${service.baseUrl}/`).toString(), {
          method: 'GET',
          headers: { Accept: 'application/json', 'X-Request-ID': requestId, 'X-Correlation-ID': requestId },
          signal: controller.signal
        });
        if (response.ok) {
          void response.body?.cancel?.().catch?.(() => {});
          result = { status: 'HEALTHY', httpStatus: response.status, errorType: null, errorMessage: null };
          break;
        }
        void response.body?.cancel?.().catch?.(() => {});
        result = safeFailure(null, response.status);
      } catch (error) {
        result = safeFailure(error);
      } finally {
        clearTimeoutFn(timeout);
        controllers.delete(controller);
      }
      if (attempt < MAX_ATTEMPTS && !stopping) {
        await new Promise(resolve => setTimeoutFn(resolve, RETRY_DELAY_MS));
      }
    }
    if (stopping) return statuses.get(service.name);
    result ||= { status: 'UNKNOWN', httpStatus: null, errorType: 'MONITOR_STOPPED', errorMessage: 'Health check was interrupted.' };
    const previous = statuses.get(service.name);
    const state = {
      serviceName: service.name,
      status: result.status,
      checkedAt: now().toISOString(),
      responseTimeMs: Math.max(0, Date.now() - startedAt),
      httpStatus: result.httpStatus,
      errorType: result.errorType,
      errorMessage: result.errorMessage
    };
    statuses.set(service.name, state);
    const context = { event: 'service_health_check', requestId, service: service.name, status: state.status, responseTimeMs: state.responseTimeMs, httpStatus: state.httpStatus };
    if (state.status === 'HEALTHY') logger.info?.(JSON.stringify(context));
    else logger.warn?.(JSON.stringify({ ...context, errorType: state.errorType }));
    if (previous?.status !== 'UNKNOWN' && previous?.status !== state.status) {
      logger.info?.(JSON.stringify({
        event: state.status === 'HEALTHY' ? 'service_health_recovered' : 'service_health_state_changed',
        requestId,
        service: service.name,
        previousStatus: previous.status,
        status: state.status
      }));
    }
    return state;
  };

  const runCycle = () => {
    if (stopping || activeCycle) return Promise.resolve({ skipped: true, results: snapshot() });
    const queue = [...services];
    const worker = async () => {
      while (!stopping && queue.length) {
        const service = queue.shift();
        if (service) await checkService(service);
      }
    };
    activeCycle = Promise.all(Array.from({ length: Math.min(Math.max(1, maxConcurrency), queue.length || 1) }, worker))
      .then(() => ({ skipped: false, results: snapshot() }))
      .finally(() => { activeCycle = null; });
    return activeCycle;
  };

  const snapshot = () => {
    const servicesStatus = [...statuses.values()].map(status => ({ ...status }));
    const checkedAt = servicesStatus.map(service => service.checkedAt).filter(Boolean).sort().at(-1) || null;
    const criticalUnavailable = services.some(service => {
      const status = statuses.get(service.name)?.status;
      return service.critical && status !== 'UNKNOWN' && status !== 'HEALTHY';
    });
    const allHealthy = servicesStatus.length > 0 && servicesStatus.every(service => service.status === 'HEALTHY');
    return {
      overallStatus: allHealthy ? 'HEALTHY' : criticalUnavailable ? 'UNHEALTHY' : servicesStatus.some(service => service.status !== 'UNKNOWN') ? 'DEGRADED' : 'UNKNOWN',
      checkedAt,
      services: servicesStatus
    };
  };

  const start = () => {
    if (!enabled || timer) return stop;
    stopping = false;
    timer = setIntervalFn(() => { void runCycle(); }, intervalMs);
    timer?.unref?.();
    logger.info?.(JSON.stringify({ event: 'service_health_scheduler_registered', intervalMs, serviceCount: services.length }));
    if (runOnStartup) void runCycle();
    return stop;
  };

  const stop = async () => {
    stopping = true;
    if (timer) clearIntervalFn(timer);
    timer = null;
    for (const controller of controllers) controller.abort();
    if (activeCycle) await activeCycle;
  };

  const checkNow = async () => {
    if (stopping) return snapshot();
    if (activeCycle) return (await activeCycle).results;
    return (await runCycle()).results;
  };

  return { start, stop, runCycle, checkNow, snapshot, isRunning: () => Boolean(activeCycle), isScheduled: () => Boolean(timer) };
}
