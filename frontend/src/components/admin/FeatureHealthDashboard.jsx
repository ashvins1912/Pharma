import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../../api/apiClient';
import { ComponentLoader, CardSkeleton, TableSkeleton, ErrorState, EmptyState } from '../common/ComponentLoader';

const TAXONOMY_COLORS = {
  RBAC_BLOCKER: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800',
  TENANT_ISOLATION_BLOCKER: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
  AUTHENTICATION_BLOCKER: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
  API_BLOCKER: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
  DATABASE_BLOCKER: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800',
  SERVICE_BLOCKER: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800',
  UI_BLOCKER: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800',
  BUSINESS_WORKFLOW_BLOCKER: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-800'
};

const SEVERITY_COLORS = {
  P0: 'bg-rose-600 text-white font-black',
  P1: 'bg-orange-600 text-white font-black',
  P2: 'bg-amber-500 text-white font-bold',
  P3: 'bg-blue-600 text-white font-medium'
};

export default function FeatureHealthDashboard() {
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);
  const [probingServiceId, setProbingServiceId] = useState(null);
  const [probingAllServices, setProbingAllServices] = useState(false);
  const [error, setError] = useState('');
  const [healthData, setHealthData] = useState(null);
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedRole, setSelectedRole] = useState('ALL');
  const [inspectCell, setInspectCell] = useState(null);

  const fetchHealth = useCallback(async (fresh = false) => {
    try {
      setLoading(true);
      setError('');
      const res = await apiClient.get('/api/v1/admin/feature-health', {
        params: { fresh: fresh ? 'true' : 'false' }
      });
      if (res.data?.success) {
        setHealthData(res.data.data);
      } else {
        setError('Failed to retrieve feature health report.');
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Error communicating with Feature Health API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth(false);
  }, [fetchHealth]);

  const handleRunAudit = async () => {
    try {
      setAuditing(true);
      setError('');
      const res = await apiClient.post('/api/v1/admin/feature-health/run-audit');
      if (res.data?.success && res.data?.data) {
        setHealthData(res.data.data);
      } else {
        setError('Audit completed without a feature health report.');
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Audit execution failed.');
    } finally {
      setAuditing(false);
    }
  };

  const handleProbeAllServices = async () => {
    try {
      setProbingAllServices(true);
      setError('');
      const res = await apiClient.post('/api/v1/admin/feature-health/probe-services', { timeoutMs: 15000 });
      if (res.data?.success) {
        // Rebuild score and blocker summaries using the newly cached service results.
        await fetchHealth(false);
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Microservice probe failed.');
    } finally {
      setProbingAllServices(false);
    }
  };

  const handleProbeSingleService = async (service) => {
    setProbingServiceId(service.id);
    const start = Date.now();
    try {
      // Direct browser-side 60s probe with fallback
      // Try probing via API Gateway proxy first to bypass browser CORS restrictions on Render services
      let probeResult = null;
      try {
        const proxyRes = await apiClient.get('/api/v1/admin/feature-health/probe-service', {
          params: { serviceId: service.id, url: service.url, timeoutMs: 15000 }
        });
        if (proxyRes.data?.success) {
          probeResult = proxyRes.data;
        }
      } catch {
        // Fall back to direct browser fetch
      }

      if (probeResult) {
        setHealthData(prev => {
          if (!prev) return prev;
          const updatedServices = prev.services.map(s => {
            if (s.id === service.id) {
              return {
                ...s,
                status: probeResult.healthy ? 'HEALTHY' : 'DEGRADED',
                httpStatus: probeResult.statusCode,
                latencyMs: probeResult.latencyMs,
                healthy: probeResult.healthy,
                lastChecked: probeResult.lastChecked || new Date().toISOString(),
                error: probeResult.healthy ? null : probeResult.error
              };
            }
            return s;
          });
          return { ...prev, services: updatedServices };
        });
        return;
      }

      // Direct browser-side probe with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const resp = await fetch(service.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const latency = Date.now() - start;
      const isHealthy = resp.ok;

      setHealthData(prev => {
        if (!prev) return prev;
        const updatedServices = prev.services.map(s => {
          if (s.id === service.id) {
            return {
              ...s,
              status: isHealthy ? 'HEALTHY' : 'DEGRADED',
              httpStatus: resp.status,
              latencyMs: latency,
              healthy: isHealthy,
              lastChecked: new Date().toISOString(),
              error: isHealthy ? null : `HTTP ${resp.status}`
            };
          }
          return s;
        });
        return { ...prev, services: updatedServices };
      });
    } catch (err) {
      const latency = Date.now() - start;
      setHealthData(prev => {
        if (!prev) return prev;
        const updatedServices = prev.services.map(s => {
          if (s.id === service.id) {
            return {
              ...s,
              status: 'OFFLINE',
              httpStatus: 0,
              latencyMs: latency,
              healthy: false,
              lastChecked: new Date().toISOString(),
              error: err.name === 'AbortError' ? 'Probe timed out (60s)' : err.message
            };
          }
          return s;
        });
        return { ...prev, services: updatedServices };
      });
    } finally {
      setProbingServiceId(null);
    }
  };

  const filteredBlockers = useMemo(() => {
    if (!healthData?.blockers) return [];
    return healthData.blockers.filter(b => {
      const matchSev = selectedSeverity === 'ALL' || b.severity === selectedSeverity;
      const matchCat = selectedCategory === 'ALL' || b.category === selectedCategory;
      const matchRole = selectedRole === 'ALL' || b.role === selectedRole || b.role === 'ALL';
      return matchSev && matchCat && matchRole;
    });
  }, [healthData?.blockers, selectedSeverity, selectedCategory, selectedRole]);

  const handleExportJson = () => {
    if (!healthData) return;
    const blob = new Blob([JSON.stringify(healthData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pharma-feature-health-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !healthData) {
    return (
      <div className="space-y-6 animate-fade-in">
        <ComponentLoader
          title="Executing Continuous RBAC Validation & Microservice Health Probes…"
          subtitle="Verifying 9 master roles, multi-tenant isolation boundaries, and probing upstream Render services."
          variant="spinner"
        />
        <CardSkeleton count={6} columns="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
      </div>
    );
  }

  const summary = healthData?.summary || {};
  const services = healthData?.services || [];
  const matrix = healthData?.matrix || { roles: [], features: [] };
  const healthScore = healthData?.healthScore ?? 100;
  const systemStatus = healthData?.systemStatus || 'HEALTHY';

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Strip */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-md space-y-4 border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-blue-400">
                Super Admin Governance Engine
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide ${
                systemStatus === 'HEALTHY'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : (systemStatus === 'DEGRADED' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30')
              }`}>
                ● {systemStatus}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
              RBAC, Feature Availability &amp; Blocker Intelligence
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Multi-role continuous verification, microservice telemetry signals, and tenant boundary isolation diagnostics.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunAudit}
              disabled={auditing}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-sm transition flex items-center gap-2 cursor-pointer"
            >
              <span>{auditing ? '⏳' : '⚡'}</span>
              <span>{auditing ? 'Running Full RBAC Audit…' : 'Trigger Live RBAC Audit'}</span>
            </button>

            <button
              type="button"
              onClick={handleProbeAllServices}
              disabled={probingAllServices}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-sm transition flex items-center gap-2 cursor-pointer"
            >
              <span>{probingAllServices ? '⏳' : '🌐'}</span>
              <span>{probingAllServices ? 'Probing Services (up to 15s)…' : 'Probe All Services'}</span>
            </button>

            <button
              type="button"
              onClick={() => fetchHealth(true)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3.5 py-2.5 rounded-xl border border-slate-700 transition cursor-pointer"
              title="Refresh Health Report"
            >
              ↻ Refresh
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3.5 py-2.5 rounded-xl border border-slate-700 transition cursor-pointer"
              title="Export Report JSON"
            >
              📥 Export Audit
            </button>
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-slate-900">
          <div className="bg-white rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Overall Platform Health
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-black text-slate-900">{healthScore}%</span>
              <span className={`text-xs font-black ${healthScore >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {healthScore >= 90 ? 'Nominal' : 'Action Required'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              RBAC (60%) + Microservices (40%)
            </span>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Automated RBAC Checks
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-black text-emerald-600">
                {summary.passedRbacChecks || 0}
              </span>
              <span className="text-xs font-bold text-slate-400">
                / {summary.totalRbacChecks || 0} passed
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {summary.failedRbacChecks || 0} failed | {summary.totalRolesChecked || 9} master roles
            </span>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Active Upstream Services
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-black text-blue-600">
                {services.filter(s => s.healthy).length}
              </span>
              <span className="text-xs font-bold text-slate-400">
                / {services.length} connected
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              API Gateway, Caching, Inventory, Core, Rx, Sockets
            </span>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-xs">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Canonical Blockers
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-3xl font-black ${summary.totalBlockers > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {summary.totalBlockers || 0}
              </span>
              <span className="text-xs font-bold text-slate-400">
                P0: {summary.severityCounts?.P0 || 0} | P1: {summary.severityCounts?.P1 || 0}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {summary.severityCounts?.P2 || 0} P2 moderate | {summary.severityCounts?.P3 || 0} P3 low
            </span>
          </div>
        </div>
      </div>

      {error && (
        <ErrorState
          title="Feature Health Telemetry Notice"
          message={error}
          onRetry={() => fetchHealth(true)}
        />
      )}

      {/* Microservices Health Section (Green/Red signal + 60s probe) */}
      <section className="bg-white dark:bg-gray-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 dark:border-gray-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Microservice Reliability Signal
            </span>
            <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
              Backend Microservices Health &amp; Wake-Up Radar
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live automated status pinging all 6 core microservice endpoints. Click &ldquo;Probe&rdquo; to wake cold-start instances with up to 60s tolerance.
            </p>
          </div>
          <span className="text-xs font-bold text-slate-400">
            Last Checked: {healthData?.timestamp ? new Date(healthData.timestamp).toLocaleTimeString() : 'Just now'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {services.map(svc => {
            const isProbing = probingServiceId === svc.id;
            return (
              <div
                key={svc.id}
                className={`p-4 rounded-2xl border transition ${
                  svc.healthy
                    ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/50'
                    : 'border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 dark:border-rose-900/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      svc.healthy ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-rose-500 shadow-sm shadow-rose-500/50 animate-pulse'
                    }`} />
                    <h4 className="text-xs font-black text-slate-900 dark:text-white truncate">
                      {svc.name}
                    </h4>
                  </div>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                    svc.healthy
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
                  }`}>
                    {svc.status}
                  </span>
                </div>

                <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                  <p className="truncate font-mono text-[10px]" title={svc.url}>
                    {svc.url}
                  </p>
                  <div className="flex items-center justify-between text-[10px] font-medium pt-1 text-slate-600 dark:text-slate-300">
                    <span>Latency: <strong>{svc.latencyMs ?? '--'} ms</strong></span>
                    <span>HTTP Status: <strong>{svc.httpStatus ? svc.httpStatus : (svc.healthy ? 200 : 'ERR')}</strong></span>
                  </div>
                  {svc.error && (
                    <p className="text-[10px] text-rose-600 dark:text-rose-400 font-bold mt-1 truncate" title={svc.error}>
                      Error: {svc.error}
                    </p>
                  )}
                </div>

                <div className="mt-3 pt-2 border-t border-slate-200/60 dark:border-gray-800 flex justify-between items-center">
                  <span className="text-[9px] text-slate-400">
                    {svc.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleProbeSingleService(svc)}
                    disabled={isProbing || probingAllServices}
                    className="text-[10px] font-extrabold px-2.5 py-1 bg-white dark:bg-gray-800 hover:bg-slate-100 dark:hover:bg-gray-700 text-slate-800 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-gray-700 shadow-2xs transition cursor-pointer disabled:opacity-50"
                  >
                    {isProbing ? 'Probing (60s)…' : 'Probe Signal ↻'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Master Role-Wise Feature Validation Matrix */}
      <section className="bg-white dark:bg-gray-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 dark:border-gray-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">
              Role-Wise Access &amp; Feature Availability Matrix
            </span>
            <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
              Master RBAC Multi-Role Validation Matrix
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Continuous validation for Customer, Tenant Owner, Tenant Admin, Pharmacist, Pharmacy Staff, Inventory Manager, Rider, and Super Admin.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-extrabold">
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">HEALTHY (Permitted)</span>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 dark:bg-gray-800 dark:text-slate-300 rounded-md">RESTRICTED (Denied by Policy)</span>
            <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded-md">FAILING (Violation)</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-gray-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-3 bg-slate-50 dark:bg-gray-800/50 sticky left-0 z-10 min-w-[200px]">
                  Feature Name &amp; Endpoint
                </th>
                {matrix.roles.map(r => (
                  <th key={r} className="py-3 px-2 text-center bg-slate-50 dark:bg-gray-800/50 whitespace-nowrap min-w-[100px]">
                    {r.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800 text-xs">
              {matrix.features.map(feat => (
                <tr key={feat.id} className="hover:bg-slate-50/60 dark:hover:bg-gray-800/30 transition">
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-white bg-slate-50/50 dark:bg-gray-800/30 sticky left-0 z-10">
                    <div>{feat.name}</div>
                    <div className="text-[10px] font-mono text-slate-400 mt-0.5 font-normal">
                      <span className="text-blue-500 font-bold">{feat.method}</span> {feat.endpoint}
                    </div>
                  </td>
                  {matrix.roles.map(role => {
                    const res = feat.results?.[role];
                    const status = res?.status || 'UNKNOWN';

                    let badgeClass = 'bg-slate-100 text-slate-700 dark:bg-gray-800 dark:text-slate-300';
                    let icon = '🔒';
                    let text = 'RESTRICTED';

                    if (status === 'HEALTHY') {
                      badgeClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800';
                      icon = '✓';
                      text = 'PERMITTED';
                    } else if (status === 'RESTRICTED') {
                      badgeClass = 'bg-slate-100 text-slate-700 dark:bg-gray-800 dark:text-slate-300 border border-slate-200 dark:border-gray-700';
                      icon = '⊘';
                      text = 'RESTRICTED';
                    } else if (status === 'FAILING') {
                      badgeClass = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800 font-black animate-pulse';
                      icon = '⚠️';
                      text = 'FAILING';
                    }

                    return (
                      <td key={role} className="py-2.5 px-2 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => setInspectCell({ feature: feat, role, result: res })}
                          className={`w-full py-1.5 px-2 rounded-xl text-[10px] font-extrabold flex items-center justify-center gap-1 transition cursor-pointer hover:scale-105 ${badgeClass}`}
                          title={`Click to inspect details for ${role}`}
                        >
                          <span>{icon}</span>
                          <span>{text}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Canonical Blocker Intelligence Center */}
      <section className="bg-white dark:bg-gray-900 rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 dark:border-gray-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-gray-800 pb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
              Canonical Blocker Intelligence (P0-P3)
            </span>
            <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
              Platform &amp; RBAC Blocker Diagnostics
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Classified into 8 canonical taxonomy buckets with actionable engineering remediation playbooks.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Severity Filter */}
            <select
              value={selectedSeverity}
              onChange={e => setSelectedSeverity(e.target.value)}
              className="text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <option value="ALL">All Severities</option>
              <option value="P0">P0 (Critical / Outage)</option>
              <option value="P1">P1 (Workflow Blocker)</option>
              <option value="P2">P2 (Moderate / Branch)</option>
              <option value="P3">P3 (Minor)</option>
            </select>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <option value="ALL">All 8 Taxonomies</option>
              <option value="RBAC_BLOCKER">RBAC Blocker</option>
              <option value="TENANT_ISOLATION_BLOCKER">Tenant Isolation Blocker</option>
              <option value="AUTHENTICATION_BLOCKER">Authentication Blocker</option>
              <option value="API_BLOCKER">API Blocker</option>
              <option value="DATABASE_BLOCKER">Database Blocker</option>
              <option value="SERVICE_BLOCKER">Service Blocker</option>
              <option value="UI_BLOCKER">UI Blocker</option>
              <option value="BUSINESS_WORKFLOW_BLOCKER">Business Workflow Blocker</option>
            </select>
          </div>
        </div>

        {filteredBlockers.length === 0 ? (
          <EmptyState
            icon="🛡️"
            title="Zero active blockers detected"
            description="All evaluated role boundaries, scopes, and upstream microservices are operating nominally."
          />
        ) : (
          <div className="space-y-3">
            {filteredBlockers.map(blocker => {
              const catClass = TAXONOMY_COLORS[blocker.category] || 'bg-slate-100 text-slate-800 border-slate-200';
              const sevClass = SEVERITY_COLORS[blocker.severity] || 'bg-slate-600 text-white';

              return (
                <div
                  key={blocker.id}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] ${sevClass}`}>
                        {blocker.severity}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${catClass}`}>
                        {blocker.category.replace('_', ' ')}
                      </span>
                      <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                        {blocker.id}
                      </span>
                    </div>
                    <div className="text-[11px] font-bold text-slate-500">
                      Scope: <span className="text-indigo-600 dark:text-indigo-400">{blocker.role || 'ALL'}</span> | Tenant: <span className="text-slate-800 dark:text-slate-200">{blocker.tenant || 'GLOBAL'}</span>
                    </div>
                  </div>

                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {blocker.message}
                  </p>

                  {blocker.recommendedAction && (
                    <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-xl text-[11px] text-blue-900 dark:text-blue-200 font-medium">
                      <span className="font-bold">Recommended Action: </span>
                      {blocker.recommendedAction}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Inspect Cell Modal */}
      {inspectCell && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="feature-inspection-title" tabIndex={-1} className="bg-white dark:bg-gray-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-gray-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-600">
                  Feature Security Inspection
                </span>
                <h3 id="feature-inspection-title" className="text-base font-black text-slate-900 dark:text-white">
                  {inspectCell.feature.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectCell(null)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-slate-300 font-black flex items-center justify-center cursor-pointer hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-gray-800/50 p-4 rounded-2xl">
              <div className="flex justify-between">
                <span className="text-slate-500">Evaluated Role:</span>
                <span className="font-bold text-slate-900 dark:text-white">{inspectCell.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Endpoint &amp; Method:</span>
                <span className="font-mono text-[11px]">{inspectCell.feature.method} {inspectCell.feature.endpoint}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Required Permission:</span>
                <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{inspectCell.feature.requiredPermission}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Required Scope:</span>
                <span className="font-bold">{inspectCell.feature.requiredScope}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Evaluation Result:</span>
                <span className={`font-black ${inspectCell.result?.status === 'HEALTHY' ? 'text-emerald-600' : 'text-slate-600'}`}>
                  {inspectCell.result?.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Tenant Isolation Verified:</span>
                <span className="font-bold text-emerald-600">
                  {inspectCell.result?.tenantIsolationVerified ? '✓ Verified Safe' : '⚠️ Failed'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Revocation Negative Test:</span>
                <span className="font-bold text-emerald-600">
                  {inspectCell.result?.revocationEnforced ? '✓ Enforced' : '⚠️ Bypassed'}
                </span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInspectCell(null)}
                className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
