import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useTenant } from '../../context/TenantContext';

/**
 * Persisted campaign editor. Local Offer Zone curation is only a preview;
 * these records are the campaigns consumed by the customer-facing offer API.
 */
export default function SavedCampaignsEditor() {
  const { tenantId } = useTenant();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});

  const loadCampaigns = useCallback(async () => {
    if (!tenantId) { setCampaigns([]); return; }
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/surplus-savings/admin', { params: { tenantId } });
      const rows = Array.isArray(response.data?.campaigns) ? response.data.campaigns : [];
      setCampaigns(rows);
      setDrafts(Object.fromEntries(rows.map(row => [String(row._id), {
        name: row.name || '',
        description: row.description || '',
        endsAt: row.endsAt ? new Date(row.endsAt).toISOString().slice(0, 10) : '',
        status: row.status || 'DRAFT'
      }])));
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Saved campaigns could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);

  const updateDraft = (id, field, value) => setDrafts(current => ({
    ...current, [id]: { ...current[id], [field]: value }
  }));

  const saveCampaign = async id => {
    const draft = drafts[id];
    if (!draft?.name?.trim() || !draft.endsAt) {
      setError('Campaign name and end date are required.');
      return;
    }
    setSavingId(id);
    setError('');
    try {
      await apiClient.patch(`/api/surplus-savings/admin/${id}`, {
        tenantId,
        name: draft.name.trim(),
        description: draft.description,
        endsAt: new Date(`${draft.endsAt}T23:59:59.999`).toISOString(),
        status: draft.status
      }, { params: { tenantId } });
      await loadCampaigns();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Campaign changes could not be saved.');
    } finally {
      setSavingId('');
    }
  };

  const pauseCampaign = async id => {
    setSavingId(id);
    setError('');
    try {
      await apiClient.delete(`/api/surplus-savings/admin/${id}`, { params: { tenantId } });
      await loadCampaigns();
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Campaign could not be paused.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">Saved campaigns · customer-facing</h3>
          <p className="mt-1 text-xs text-slate-500">Edit persisted campaigns here. Changes are saved to the selected pharmacy and immediately affect eligible Offer Zone items.</p>
        </div>
        <button type="button" onClick={loadCampaigns} disabled={loading || !tenantId} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">{loading ? 'Loading…' : 'Refresh campaigns'}</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {!tenantId && <p className="text-xs text-amber-700">Select a pharmacy to manage its campaigns.</p>}
      {loading && campaigns.length === 0 && <p className="text-xs text-slate-500">Loading saved campaigns…</p>}
      {!loading && tenantId && campaigns.length === 0 && <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No saved campaigns yet. Create one from the campaign creation workflow.</p>}
      <div className="space-y-3">
        {campaigns.map(campaign => {
          const id = String(campaign._id);
          const draft = drafts[id] || {};
          return (
            <article key={id} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-bold text-slate-600 sm:col-span-2">Campaign name
                <input value={draft.name || ''} onChange={event => updateDraft(id, 'name', event.target.value)} maxLength={120} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900" />
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-600 sm:col-span-2">Description
                <textarea value={draft.description || ''} onChange={event => updateDraft(id, 'description', event.target.value)} maxLength={500} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900" />
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-600">Campaign end date
                <input type="date" value={draft.endsAt || ''} onChange={event => updateDraft(id, 'endsAt', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
              </label>
              <label className="space-y-1 text-xs font-bold text-slate-600">Status
                <select value={draft.status || 'DRAFT'} onChange={event => updateDraft(id, 'status', event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">
                  <option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option>
                </select>
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                <span className="text-[11px] text-slate-500">{(campaign.medicineIds || []).length} medicines · {campaign.discountType === 'percentage' ? `${campaign.discountValue}%` : `₹${campaign.discountValue}`} discount · {campaign.usageCount || 0} redeemed</span>
                <div className="flex gap-2">
                  <button type="button" disabled={savingId === id} onClick={() => pauseCampaign(id)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Pause</button>
                  <button type="button" disabled={savingId === id} onClick={() => saveCampaign(id)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingId === id ? 'Saving…' : 'Save changes'}</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
