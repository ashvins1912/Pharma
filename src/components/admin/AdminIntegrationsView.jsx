import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';

export default function AdminIntegrationsView() {
  const { activeBranch, activeTenant } = useApp();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [integration, setIntegration] = useState(null);

  const [formData, setFormData] = useState({
    provider: 'CSQUARE',
    apiUrl: 'https://api.csquarepharma.example.com',
    clientId: 'CSQ-ASHVIN-INDORE',
    storeId: 'STORE-PALASIA-01',
    apiKey: '',
    syncIntervalMinutes: 15,
    productSync: true,
    stockSync: true,
    priceSync: true,
    orderSync: true,
    invoiceSync: true
  });

  const loadIntegration = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/v1/integrations?branchId=${activeBranch.id}`);
      if (res.data?.data) {
        const d = res.data.data;
        setIntegration(d);
        setFormData({
          provider: d.provider || 'CSQUARE',
          apiUrl: d.config?.apiUrl || 'https://api.csquarepharma.example.com',
          clientId: d.config?.clientId || '',
          storeId: d.config?.storeId || '',
          apiKey: d.config?.apiKey || '',
          syncIntervalMinutes: d.config?.syncIntervalMinutes || 15,
          productSync: d.capabilities?.productSync ?? true,
          stockSync: d.capabilities?.stockSync ?? true,
          priceSync: d.capabilities?.priceSync ?? true,
          orderSync: d.capabilities?.orderSync ?? true,
          invoiceSync: d.capabilities?.invoiceSync ?? true
        });
      }
    } catch (err) {
      console.warn('Failed to load integration settings:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegration();
  }, [activeBranch?.id]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        branchId: activeBranch.id,
        provider: formData.provider,
        capabilities: {
          productSync: formData.productSync,
          stockSync: formData.stockSync,
          priceSync: formData.priceSync,
          orderSync: formData.orderSync,
          invoiceSync: formData.invoiceSync
        },
        config: {
          apiUrl: formData.apiUrl,
          clientId: formData.clientId,
          storeId: formData.storeId,
          apiKey: formData.apiKey,
          syncIntervalMinutes: Number(formData.syncIntervalMinutes)
        }
      };

      const res = await apiClient.put('/api/v1/integrations', payload);
      if (res.data?.success) {
        setIntegration(res.data.data);
        addToast('Integration settings updated successfully.', 'success');
      }
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to update integration.', 'error');
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await apiClient.post('/api/v1/integrations/test-connection', {
        branchId: activeBranch.id
      });
      if (res.data?.success) {
        addToast(res.data.data?.message || 'Connection established!', 'success');
        loadIntegration();
      }
    } catch (err) {
      addToast(err.response?.data?.message || 'Connection failed to external POS.', 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await apiClient.post('/api/v1/integrations/sync', {
        branchId: activeBranch.id,
        syncType: 'STOCK'
      });
      if (res.data?.success) {
        addToast(res.data.data?.message || 'Inventory synchronized successfully.', 'success');
        loadIntegration();
      }
    } catch (err) {
      addToast(err.response?.data?.message || 'Sync operation failed.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Overview Card */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏢</span>
            <h3 className="text-base font-black text-slate-900">
              Branch POS & C-Square ERP Integration
            </h3>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                integration?.status === 'CONNECTED'
                  ? 'bg-emerald-100 text-emerald-800'
                  : integration?.status === 'ERROR'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {integration?.status || 'CONNECTED'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Active Store Context: <strong className="text-slate-800">{activeBranch?.name}</strong> (Tenant: {activeTenant?.name})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            {testing ? 'Testing...' : '🔌 Ping Connection'}
          </button>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-sm transition cursor-pointer disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : '🔄 Sync Stock Now'}
          </button>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
        <div>
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-3">
            Provider Configuration
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Integration Provider
              </label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData(prev => ({ ...prev, provider: e.target.value }))}
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="CSQUARE">C-Square Pharma POS / ERP</option>
                <option value="MANUAL">Ashvin Managed (Standalone Inventory)</option>
                <option value="OTHER_POS">Generic POS / External Webhook</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                API Base URL
              </label>
              <input
                type="url"
                value={formData.apiUrl}
                onChange={(e) => setFormData(prev => ({ ...prev, apiUrl: e.target.value }))}
                placeholder="https://api.csquarepharma.example.com"
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Client ID
              </label>
              <input
                type="text"
                value={formData.clientId}
                onChange={(e) => setFormData(prev => ({ ...prev, clientId: e.target.value }))}
                placeholder="CSQ-ASHVIN-STORE"
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Store / Branch ID in POS
              </label>
              <input
                type="text"
                value={formData.storeId}
                onChange={(e) => setFormData(prev => ({ ...prev, storeId: e.target.value }))}
                placeholder="STORE-PALASIA-01"
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                API Key / Secret Token
              </label>
              <input
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="••••••••••••••••"
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Automated Sync Frequency
              </label>
              <select
                value={formData.syncIntervalMinutes}
                onChange={(e) => setFormData(prev => ({ ...prev, syncIntervalMinutes: e.target.value }))}
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="5">Every 5 Minutes</option>
                <option value="15">Every 15 Minutes (Recommended)</option>
                <option value="30">Every 30 Minutes</option>
                <option value="60">Every Hour</option>
              </select>
            </div>
          </div>
        </div>

        {/* Sync Capability Toggles */}
        <div>
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-3">
            Active Sync Capabilities
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { key: 'stockSync', label: 'Inventory Stock', desc: 'Syncs available & reserved units' },
              { key: 'productSync', label: 'Drug Master', desc: 'Imports new pharmaceutical SKUs' },
              { key: 'priceSync', label: 'MRP & Rates', desc: 'Updates source selling prices' },
              { key: 'orderSync', label: 'Order Pushes', desc: 'Transfers orders to POS counter' },
              { key: 'invoiceSync', label: 'Invoices', desc: 'Fetches digital GST bills' }
            ].map(cap => (
              <label key={cap.key} className="flex flex-col p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 cursor-pointer select-none">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">{cap.label}</span>
                  <input
                    type="checkbox"
                    checked={formData[cap.key]}
                    onChange={(e) => setFormData(prev => ({ ...prev, [cap.key]: e.target.checked }))}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1">{cap.desc}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer"
          >
            💾 Save Integration Settings
          </button>
        </div>
      </form>

      {/* Sync History Table */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-3">
          Recent Synchronization Log
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3">Job ID</th>
                <th className="py-2.5 px-3">Operation</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Items Processed</th>
                <th className="py-2.5 px-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {(integration?.syncHistory || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400">
                    No sync logs recorded yet for this branch.
                  </td>
                </tr>
              ) : (
                integration.syncHistory.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-mono text-slate-500">{item.jobId}</td>
                    <td className="py-2.5 px-3 font-semibold">{item.type}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">{item.itemsProcessed} records</td>
                    <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                      {new Date(item.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
