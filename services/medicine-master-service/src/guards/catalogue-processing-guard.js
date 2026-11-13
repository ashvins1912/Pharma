import os from 'node:os';
import v8 from 'node:v8';

const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const catalogueProcessingLimits = Object.freeze({
  maxConcurrentJobs: boundedInteger(process.env.MEDICINE_CATALOGUE_MAX_CONCURRENT_JOBS, 2, 1, 8),
  maxQueuedJobs: boundedInteger(process.env.MEDICINE_CATALOGUE_MAX_QUEUED_JOBS, 10, 1, 500),
  maxHeapPercent: boundedInteger(process.env.MEDICINE_CATALOGUE_MAX_HEAP_PERCENT, 80, 50, 95),
  maxRssMb: boundedInteger(process.env.MEDICINE_CATALOGUE_MAX_RSS_MB, 1024, 256, 16_384),
  maxRssPercent: boundedInteger(process.env.MEDICINE_CATALOGUE_MAX_RSS_PERCENT, 80, 50, 95),
  maxCpuLoadPercent: boundedInteger(process.env.MEDICINE_CATALOGUE_MAX_CPU_LOAD_PERCENT, 85, 25, 100),
  workerLeaseMs: boundedInteger(process.env.MEDICINE_CATALOGUE_WORKER_LEASE_MS, 900_000, 30_000, 3_600_000),
  pollIntervalMs: boundedInteger(process.env.MEDICINE_CATALOGUE_WORKER_POLL_MS, 1_500, 500, 30_000)
});

export function evaluateCatalogueProcessingGuard({
  enabled = process.env.MEDICINE_CATALOGUE_PROCESSING_ENABLED !== 'false',
  heapUsedPercent = 0,
  rssUsedPercent = 0,
  cpuLoadPercent = 0,
  queuedJobs = 0
} = {}) {
  const reasons = [];
  if (!enabled) reasons.push('PROCESSING_DISABLED');
  if (heapUsedPercent >= catalogueProcessingLimits.maxHeapPercent) reasons.push('HEAP_PRESSURE');
  if (rssUsedPercent >= catalogueProcessingLimits.maxRssPercent) reasons.push('RSS_PRESSURE');
  if (cpuLoadPercent >= catalogueProcessingLimits.maxCpuLoadPercent) reasons.push('CPU_PRESSURE');
  if (queuedJobs >= catalogueProcessingLimits.maxQueuedJobs) reasons.push('QUEUE_CAPACITY_REACHED');
  return { allowed: reasons.length === 0, reasons };
}

export function getCatalogueProcessingResourceSnapshot() {
  const memory = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit || 1;
  const cpuCount = Math.max(1, os.cpus().length);
  const cpuLoadPercent = Math.min(100, (os.loadavg()[0] / cpuCount) * 100);
  return {
    process: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      heapLimitBytes: heapLimit,
      heapUsedPercent: Number(((memory.heapUsed / heapLimit) * 100).toFixed(2)),
      rssUsedPercent: Number(((memory.rss / (catalogueProcessingLimits.maxRssMb * 1024 * 1024)) * 100).toFixed(2))
    },
    host: {
      cpuCount,
      cpuLoadPercent: Number(cpuLoadPercent.toFixed(2)),
      freeMemoryBytes: os.freemem(),
      totalMemoryBytes: os.totalmem()
    }
  };
}
