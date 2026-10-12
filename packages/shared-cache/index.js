const DEFAULT_TIMEOUT_MS = 2500;

function normalizeBaseUrl(value) {
  if (!value) return null;
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('CACHE_SERVICE_URL must use HTTP or HTTPS.');
  return parsed.origin;
}

export class SharedCacheClient {
  constructor({
    baseUrl = process.env.CACHE_SERVICE_URL,
    token = process.env.CACHE_SERVICE_TOKEN,
    timeoutMs = Number(process.env.CACHE_SERVICE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    fetchImpl = globalThis.fetch
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token || '';
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
      throw new Error('CACHE_SERVICE_TIMEOUT_MS must be between 100 and 30000.');
    }
    this.configurationError = this.baseUrl && this.token.length < 32
      ? 'CACHE_SERVICE_TOKEN must contain at least 32 characters when CACHE_SERVICE_URL is configured.'
      : null;
  }

  get enabled() { return Boolean(this.baseUrl && !this.configurationError); }

  async request(path, { method = 'GET', body, timeoutMs = this.timeoutMs } = {}) {
    if (!this.baseUrl) throw new Error('Shared cache is not configured (CACHE_SERVICE_URL is empty).');
    if (this.configurationError) throw new Error(this.configurationError);
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-cache-service-token': this.token
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const error = new Error(`Cache service returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  async get(key) {
    const result = await this.request(`/v1/cache?key=${encodeURIComponent(key)}`);
    return result?.hit ? result.value : null;
  }

  async set(key, value, ttlSeconds = 3600) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) throw new Error('ttlSeconds must be a positive integer.');
    await this.request('/v1/cache', { method: 'POST', body: { key, value, ttlSeconds } });
    return true;
  }

  async del(key) {
    const result = await this.request(`/v1/cache?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    return Boolean(result?.deleted);
  }

  async publishEvent(channel, payload, target = {}) {
    return this.request('/v1/events', {
      method: 'POST',
      body: {
        channel,
        payload,
        userId: target.userId || payload?.userId || payload?.recipientUserId || null,
        tenantId: target.tenantId || payload?.tenantId || null,
        riderId: target.riderId || payload?.riderId || null
      }
    });
  }

  async getEventCursor() {
    const result = await this.request('/v1/events/cursor');
    return result?.cursor || '0-0';
  }

  async acknowledgeEvents(cursor) {
    return this.request('/v1/events/ack', { method: 'POST', body: { cursor } });
  }

  async pollEvents(cursor = '0-0', blockMs = 5000) {
    const boundedBlockMs = Math.max(1000, Math.min(10000, Number(blockMs) || 5000));
    return this.request(`/v1/events/poll?cursor=${encodeURIComponent(cursor)}&blockMs=${boundedBlockMs}`, {
      timeoutMs: boundedBlockMs + this.timeoutMs + 500
    });
  }
}

export const sharedCache = new SharedCacheClient();
