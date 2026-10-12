import React, { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';

const STATUS_STYLES = {
  HEALTHY: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  UNHEALTHY: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  UNREACHABLE: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  TIMEOUT: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  DEGRADED: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  UNKNOWN: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
};

const labelFor = (name = '') => ({
  'api-gateway': 'API Gateway',
  'backend-api': 'Backend API',
  'cache-service': 'Shared Cache Service',
  'websocket-service': 'WebSocket / Realtime',
  'inventory-service': 'Inventory Service',
  'order-service': 'Order Service',
  'prescription-service': 'Prescription Service',
  'customer-service': 'Customer Service'
}[name] || name.replace(/[-_]/g, ' ').replace(/\\b\\w/g, char => char.toUpperCase()));

const formatTime = value => {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const normalizeStatus = value => String(value || 'UNKNOWN').toUpperCase();

function MetricCard({ label, value, hint }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export default function LiveTelemetryTab() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedInterval, setSelectedInterval] = useState('10000');
  const [refreshCount, setRefreshCount] = useState(0);
  const [events, setEvents] = useState([]);
  const previousStatuses = useRef(new Map());

  const pollTelemetry = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      // This endpoint is authenticated at the gateway and restricted to admins.
      // It returns measured health-check latency/status; it does not fabricate CPU,
      // memory, traffic or uptime values that the services do not expose.
      const response = await apiClient.get('/api/v1/health/services', { timeout: 20000 });
      const data = response?.data || {};
      const rawServices = Array.isArray(data.services) ? data.services : [];
      const checkedAt = data.checkedAt || new Date().toISOString();
      const services = rawServices.map(service => ({
        ...service,
        serviceName: service.serviceName || service.name || 'unnamed-service',
        status: normalizeStatus(service.status)
      }));

      // A successful response from this protected route confirms the gateway is
      // reachable. Add it as a separate service card while keeping upstream health
      // strictly sourced from the gateway's actual monitor snapshot.
      const gatewayStatus = {
        serviceName: 'api-gateway',
        status: 'HEALTHY',
        checkedAt,
        responseTimeMs: null,
        httpStatus: response.status,
        errorType: null,
        errorMessage: null,
        source: 'Authenticated telemetry API'
      };
      const byName = new Map(services.map(service => [service.serviceName, service]));
      byName.set('api-gateway', gatewayStatus);
      const allServices = [...byName.values()].sort((a, b) => {
        const order = ['api-gateway', 'backend-api', 'cache-service', 'websocket-service', 'inventory-service', 'order-service', 'prescription-service', 'customer-service'];
        const ai = order.indexOf(a.serviceName);
        const bi = order.indexOf(b.serviceName);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.serviceName.localeCompare(b.serviceName);
      });

      const changes = [];
      for (const service of allServices) {
        const previous = previousStatuses.current.get(service.serviceName);
        if (previous && previous !== service.status) {
          changes.push({
            id: `${service.serviceName}-${checkedAt}-${service.status}`,
            time: checkedAt,
            serviceName: service.serviceName,
            status: service.status,
            type: service.status === 'HEALTHY' ? 'SERVICE_RECOVERED' : 'SERVICE_STATUS_CHANGED',
            details: `${labelFor(service.serviceName)} changed from ${previous} to ${service.status}.`
          });
        }
        previousStatuses.current.set(service.serviceName, service.status);
      }
      if (changes.length) setEvents(current => [...changes, ...current].slice(0, 30));
      setSnapshot({
        overallStatus: normalizeStatus(data.overallStatus || data.status),
        checkedAt,
        services: allServices,
        requestId: data.requestId || response.headers?.['x-request-id'] || null
      });
      setError('');
      setRefreshCount(count => count + 1);
    } catch (requestError) {
      const statusCode = requestError?.response?.status;
      const message = statusCode === 401 || statusCode === 403
        ? 'Access denied. This telemetry view requires an authorized administrator session.'
        : requestError?.response?.data?.error?.message || requestError?.message || 'Telemetry could not be loaded.';
      setError(message);
      setEvents(current => [{
        id: `telemetry-error-${Date.now()}`,
        time: new Date().toISOString(),
        serviceName: 'api-gateway',
        status: 'UNREACHABLE',
        type: 'TELEMETRY_FETCH_FAILED',
        details: message
      }, ...current].slice(0, 30));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void pollTelemetry();
    const intervalMs = Number(selectedInterval);
    if (!intervalMs) return undefined;
    const timer = window.setInterval(() => { void pollTelemetry({ silent: true }); }, intervalMs);
    return () => window.clearInterval(timer);
  }, [pollTelemetry, selectedInterval]);

  const services = snapshot?.services || [];
  const healthyCount = services.filter(service => service.status === 'HEALTHY').length;
  const unhealthyCount = services.filter(service => ['UNHEALTHY', 'UNREACHABLE', 'TIMEOUT'].includes(service.status)).length;
  const degradedCount = services.filter(service => ['DEGRADED', 'UNKNOWN'].includes(service.status)).length;
  const overall = unhealthyCount ? 'UNHEALTHY' : degradedCount ? 'DEGRADED' : services.length ? 'HEALTHY' : 'UNKNOWN';

  return (
    <div className="min-w-0 space-y-6 animate-fadeIn">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <span className="inline-flex rounded-full border border-indigo-300/30 bg-indigo-400/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-indigo-200">
              Platform Super Admin · Restricted
            </span>
            <h2 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">Live Service Telemetry</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Live health, measured probe latency, HTTP status and last-check time for the gateway, backend, shared cache, WebSocket transport and configured domain services.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <label className="text-xs font-bold text-slate-300" htmlFor="telemetry-interval">Refresh</label>
            <select
              id="telemetry-interval"
              value={selectedInterval}
              onChange={event => setSelectedInterval(event.target.value)}
              className="rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-xs font-bold text-white outline-none focus:border-indigo-300"
            >
              <option value="10000">Every 10 seconds</option>
              <option value="30000">Every 30 seconds</option>
              <option value="60000">Every minute</option>
              <option value="0">Paused</option>
            </select>
            <button
              type="button"
              onClick={() => void pollTelemetry()}
              disabled={refreshing}
              className="rounded-xl bg-white px-3 py-2 text-xs font-extrabold text-slate-900 transition hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60"
            >
              {refreshing ? 'Refreshing…' : 'Refresh now ↻'}
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
          <span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${selectedInterval !== '0' ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`} />{selectedInterval !== '0' ? 'Auto-refresh enabled' : 'Auto-refresh paused'}</span>
          <span>Successful snapshots: {refreshCount}</span>
          <span>Last snapshot: {formatTime(snapshot?.checkedAt)}</span>
          {snapshot?.requestId && <span className="break-all">Request ID: {snapshot.requestId}</span>}
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <p className="font-extrabold">Telemetry unavailable</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Platform status" value={loading && !snapshot ? 'Loading…' : overall} hint={`Gateway snapshot: ${snapshot?.overallStatus || 'Not available'}`} />
        <MetricCard label="Services monitored" value={services.length} hint="Only configured service endpoints are included" />
        <MetricCard label="Healthy" value={healthyCount} hint="Successful latest health probes" />
        <MetricCard label="Needs attention" value={unhealthyCount + degradedCount} hint={`${unhealthyCount} unavailable · ${degradedCount} unknown/degraded`} />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">Service health matrix</h3>
            <p className="mt-1 text-xs text-slate-500">Status is measured from each service's configured health endpoint, not simulated client data.</p>
          </div>
          <span className="text-xs text-slate-500">{services.length} services · refreshed {formatTime(snapshot?.checkedAt)}</span>
        </div>
        {loading && !snapshot ? (
          <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500 dark:bg-slate-800">Loading service telemetry…</div>
        ) : services.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500 dark:bg-slate-800">No service health data has been returned yet.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {services.map(service => {
              const status = normalizeStatus(service.status);
              return (
                <article key={service.serviceName} className="min-w-0 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="break-words text-sm font-black text-slate-900 dark:text-white">{labelFor(service.serviceName)}</h4>
                      <p className="mt-1 break-all text-[11px] text-slate-500">{service.serviceName}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${STATUS_STYLES[status] || STATUS_STYLES.UNKNOWN}`}>{status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                      <p className="text-[10px] font-bold uppercase text-slate-500">Probe latency</p>
                      <p className="mt-1 text-sm font-black text-slate-900 dark:text-white">{Number.isFinite(Number(service.responseTimeMs)) && service.responseTimeMs !== null ? `${service.responseTimeMs} ms` : '—'}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                      <p className="text-[10px] font-bold uppercase text-slate-500">HTTP status</p>
                      <p className="mt-1 text-sm font-black text-slate-900 dark:text-white">{service.httpStatus ?? '—'}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-[11px] text-slate-500">
                    <p>Last checked: {formatTime(service.checkedAt)}</p>
                    {service.errorType && <p className="font-bold text-rose-600 dark:text-rose-300">Issue: {service.errorType}</p>}
                    {service.errorMessage && <p className="break-words">{service.errorMessage}</p>}
                    {service.source && <p>Source: {service.source}</p>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
        <div className="mb-4">
          <h3 className="text-base font-black text-slate-900 dark:text-white">Telemetry state changes</h3>
          <p className="mt-1 text-xs text-slate-500">Records only observed service status changes and failed telemetry fetches; no synthetic activity is generated.</p>
        </div>
        {events.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500 dark:bg-slate-800">No status changes observed in this session.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-xs">
              <thead><tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800">
                <th className="px-3 py-3">Time</th><th className="px-3 py-3">Service</th><th className="px-3 py-3">Event</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Details</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {events.map(event => <tr key={event.id}>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatTime(event.time)}</td>
                  <td className="px-3 py-3 font-bold text-slate-800 dark:text-slate-200">{labelFor(event.serviceName)}</td>
                  <td className="px-3 py-3 font-mono text-[10px] text-slate-600 dark:text-slate-400">{event.type}</td>
                  <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_STYLES[normalizeStatus(event.status)] || STATUS_STYLES.UNKNOWN}`}>{event.status}</span></td>
                  <td className="max-w-md break-words px-3 py-3 text-slate-600 dark:text-slate-400">{event.details}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-[11px] text-slate-500">Signed in as {user?.email || 'authorized administrator'}. CPU, memory, request throughput and uptime are intentionally omitted until services expose trusted measurements for those metrics.</p>
    </div>
  );
}
