import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useTenant } from '../../context/TenantContext';
import { useAuth } from '../../context/AuthContext';

export default function LiveTelemetryTab() {
  const { user, role } = useAuth();
  const { tenantId, activeTenant } = useTenant();
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pingCount, setPingCount] = useState(0);
  const [events, setEvents] = useState([]);

  const fetchTelemetry = async () => {
    try {
      const res = await apiClient.get('/ready');
      setTelemetry(res.data);
      setError('');
      setPingCount(c => c + 1);
      
      const newEvent = {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        type: 'GATEWAY_HEALTH_CHECK',
        status: res.status === 200 ? 'SUCCESS' : 'WARNING',
        details: `Gateway ready status: ${res.data?.status || 'OK'}, Database: ${res.data?.database || 'connected'}`
      };
      setEvents(prev => [newEvent, ...prev.slice(0, 19)]);
    } catch (err) {
      setError(err.message || 'Telemetry probe failed');
      const errorEvent = {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        type: 'GATEWAY_PROBE_ERROR',
        status: 'ERROR',
        details: err.message || 'Connection refused'
      };
      setEvents(prev => [errorEvent, ...prev.slice(0, 19)]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-3xl p-6 md:p-8 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-xs font-bold px-3 py-1 bg-indigo-500/30 text-indigo-300 rounded-full border border-indigo-400/30 uppercase tracking-wider">
            Super Admin Restricted Telemetry
          </span>
          <h2 className="text-2xl md:text-3xl font-black mt-2">Live UI &amp; API Gateway Telemetry</h2>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Real-time observability stream monitoring API Gateway health, multi-tenant routing, client sessions, and request pipelines.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white/10 px-4 py-3 rounded-2xl backdrop-blur-md border border-white/10">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
          <div className="text-xs">
            <p className="font-bold text-white">Live Pulse Active</p>
            <p className="text-slate-300 text-[10px]">Ping count: {pingCount} (5s interval)</p>
          </div>
        </div>
      </div>

      {/* Grid of Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-gray-800">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">API Gateway Status</span>
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-3 h-3 rounded-full ${telemetry ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span className="text-lg font-black text-slate-900 dark:text-white">
              {telemetry?.status ? telemetry.status.toUpperCase() : 'OPERATIONAL'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Service: {telemetry?.service || 'backend-api'}</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-gray-800">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Database Cluster</span>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
              {telemetry?.database ? telemetry.database.toUpperCase() : 'CONNECTED'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">MongoDB Mongoose / 2dsphere active</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-gray-800">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Active Tenant Scope</span>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 truncate">
              {activeTenant?.shopName || 'Default Dispensary'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 font-mono truncate">ID: {tenantId}</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-slate-200 dark:border-gray-800">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">UI Client &amp; Role</span>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm font-black text-slate-900 dark:text-white uppercase">
              {role || 'Super Admin'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">{user?.email || 'admin@ashvin.pharmacy'}</p>
        </div>
      </div>

      {/* Real-Time Request / Event Stream */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-gray-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white">API Gateway &amp; UI Event Stream</h3>
            <p className="text-xs text-slate-500">Live request tracking, proxy health checks, and telemetry logs.</p>
          </div>
          <button
            onClick={fetchTelemetry}
            className="px-3.5 py-2 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 text-indigo-600 dark:text-indigo-300 text-xs font-extrabold rounded-xl transition"
          >
            Refresh Now ↻
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-gray-800 text-slate-400 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Event Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Telemetry Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800 font-mono text-[11px]">
              {events.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-gray-800/50 transition">
                  <td className="py-3 px-4 text-slate-500">{ev.time}</td>
                  <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">{ev.type}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                      ev.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' :
                      ev.status === 'WARNING' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' :
                      'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                    }`}>
                      {ev.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{ev.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
