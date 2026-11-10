import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

const labelFor = value => String(value || '').replace(/([A-Z])/g, ' $1').replace(/^./, letter => letter.toUpperCase());
const displayValue = value => Array.isArray(value) ? value.join(', ') : value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
const availableBatches = batches => (batches || []).filter(batch => !batch.isImportJob && batch.status === 'PUBLISHED' && batch.batchId);

export default function MedicineCatalogueMappingReview({ batches = [], onClose, onMapped }) {
  const { addToast } = useToast();
  const options = useMemo(() => availableBatches(batches), [batches]);
  const [batchId, setBatchId] = useState(options[0]?.batchId || '');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [choices, setChoices] = useState({});
  const [selectedFields, setSelectedFields] = useState({});
  const [batchNumber, setBatchNumber] = useState(1);
  const [total, setTotal] = useState(0);

  const loadQueue = useCallback(async (id = batchId) => {
    if (!id) { setItems([]); return; }
    setLoading(true);
    try {
      const response = await apiClient.get('/api/v1/inventory/catalogue/imports/' + encodeURIComponent(id) + '/mapping-queue', {
        params: { page: 1, limit: 100 }, timeout: 45000
      });
      const rows = response.data?.items || [];
      setItems(rows);
      setTotal(Number(response.data?.pagination?.total || 0));
      setChoices({});
      setSelectedFields(Object.fromEntries(rows.map(row => [row.medicineId, (row.availableFields || []).map(field => field.key)])));
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not load the next 100 catalogue mapping records.', 'error');
      setItems([]);
    } finally { setLoading(false); }
  }, [batchId, addToast]);

  useEffect(() => { if (batchId) void loadQueue(batchId); }, [batchId, loadQueue]);

  const approve = async item => {
    const targetMedicineId = choices[item.medicineId];
    const fields = selectedFields[item.medicineId] || [];
    if (!targetMedicineId) { addToast('Select an existing catalogue match or choose Create new medicine.', 'warning'); return; }
    if (!fields.length) { addToast('Select at least one field to map.', 'warning'); return; }
    setBusyId(item.medicineId);
    try {
      await apiClient.post('/api/v1/inventory/catalogue/imports/' + encodeURIComponent(batchId) + '/map', {
        sourceMedicineId: item.medicineId, targetMedicineId, selectedFields: fields
      });
      setItems(current => current.map(row => row.medicineId === item.medicineId ? { ...row, _mapped: true } : row));
      addToast((item.brandName || item.medicineId) + ' mapped and approved for Store visibility.', 'success');
      onMapped?.();
    } catch (error) {
      addToast(error.response?.data?.message || 'Could not approve this catalogue mapping.', 'error');
    } finally { setBusyId(''); }
  };

  const mappedCount = items.filter(item => item._mapped).length;
  const pendingCount = items.length - mappedCount;
  const nextBatch = () => { setBatchNumber(value => value + 1); void loadQueue(batchId); };

  return (
    <div className="fixed inset-0 z-[160] flex h-[100dvh] items-start justify-center overflow-y-auto overscroll-y-contain bg-slate-950/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="catalogue-mapping-title">
      <section className="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
          <div className="min-w-0"><h2 id="catalogue-mapping-title" className="text-base font-black text-slate-900 sm:text-lg">Possible catalogue matches · Admin mapping</h2><p className="mt-1 text-xs leading-5 text-slate-500">Review 100 source records at a time. Select the canonical medicine and the exact fields to approve for Store visibility.</p></div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold" aria-label="Close mapping review">✕</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain touch-pan-y p-3 sm:p-5">
          <div className="grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
            <label className="min-w-0 text-xs font-bold text-slate-700">Published import batch
              <select value={batchId} onChange={event => { setBatchNumber(1); setBatchId(event.target.value); }} className="mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs">
                <option value="">Choose a published batch</option>
                {options.map(batch => <option key={batch.batchId} value={batch.batchId}>{batch.fileName || batch.dataset || batch.batchId} · {batch.batchId.slice(0, 8)}</option>)}
              </select>
            </label>
            <div className="rounded-lg bg-white px-3 py-2"><p className="text-[9px] font-bold uppercase text-slate-400">Batch window</p><p className="text-sm font-black text-slate-800">{batchNumber} · 100 rows</p></div>
            <div className="rounded-lg bg-white px-3 py-2"><p className="text-[9px] font-bold uppercase text-slate-400">Reviewed here</p><p className="text-sm font-black text-emerald-700">{mappedCount} / {items.length}</p></div>
            <button type="button" onClick={() => loadQueue()} disabled={!batchId || loading} className="min-h-10 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-bold text-indigo-700 disabled:opacity-40">{loading ? 'Loading…' : 'Refresh 100'}</button>
          </div>
          {!options.length && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">No published import batches are available yet. Complete reconciliation approval and publish a batch first; its records will remain hidden from Store search until individually mapped here.</div>}
          {batchId && <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500"><span>{total.toLocaleString()} records awaiting mapping in this batch</span><span>{pendingCount} still pending in the current 100-row window</span></div>}
          {loading && <p className="rounded-xl border p-8 text-center text-sm text-slate-500">Loading possible matches…</p>}
          {!loading && batchId && !items.length && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center"><p className="font-bold text-emerald-800">All records in this batch are mapped.</p><p className="mt-1 text-xs text-emerald-700">Every approved mapping is now eligible for Store catalogue matching.</p></div>}
          {!loading && items.map(item => {
            const chosen = choices[item.medicineId] || '';
            const selected = selectedFields[item.medicineId] || [];
            return (
              <article key={item.medicineId} className={item._mapped ? 'rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 sm:p-4' : 'rounded-xl border border-slate-200 bg-white p-3 sm:p-4'}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><h3 className="break-words text-sm font-extrabold text-slate-900">{item.brandName || item.medicineId}</h3><p className="mt-1 break-all font-mono text-[9px] text-slate-400">{item.medicineId} · {item.sourceDataset || 'Imported source'}</p></div>
                  {item._mapped ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">Approved</span> : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">Needs mapping</span>}
                </div>
                <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
                  <div><p className="text-[9px] font-bold uppercase text-slate-400">Composition</p><p className="mt-1 break-words text-xs text-slate-700">{item.composition || 'Not supplied'}</p></div>
                  <div><p className="text-[9px] font-bold uppercase text-slate-400">Strength / form</p><p className="mt-1 break-words text-xs text-slate-700">{[item.strength, item.dosageForm].filter(Boolean).join(' · ') || 'Not supplied'}</p></div>
                  <div><p className="text-[9px] font-bold uppercase text-slate-400">Manufacturer</p><p className="mt-1 break-words text-xs text-slate-700">{item.manufacturer || 'Not supplied'}</p></div>
                </div>
                {!item._mapped && <>
                  <div className="mt-3">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Choose canonical catalogue record</p>
                    <div className="grid gap-2 lg:grid-cols-2">
                      {item.candidates?.map(candidate => <label key={candidate.medicineId} className={chosen === candidate.medicineId ? 'flex cursor-pointer items-start gap-2 rounded-lg border border-indigo-400 bg-indigo-50 p-3' : 'flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 hover:bg-slate-50'}>
                        <input type="radio" name={'mapping-' + item.medicineId} checked={chosen === candidate.medicineId} onChange={() => setChoices(value => ({ ...value, [item.medicineId]: candidate.medicineId }))} className="mt-1"/>
                        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><strong className="break-words text-xs text-slate-800">{candidate.brandName || candidate.medicineId}</strong><span className="rounded bg-white px-2 py-0.5 text-[10px] font-black text-indigo-700">{candidate.evidence?.score ?? 0}% match</span></span><span className="mt-1 block break-words text-[10px] text-slate-600">{candidate.composition || 'Composition unavailable'} · {[candidate.strength, candidate.dosageForm].filter(Boolean).join(' / ') || 'Strength/form unavailable'}</span><span className="mt-1 block text-[10px] text-slate-500">{candidate.manufacturer || 'Manufacturer unavailable'} · {candidate.storeApproved ? 'Already Store-approved' : 'Not yet Store-approved'}</span>{Boolean(candidate.evidence?.warnings?.length) && <span className="mt-1 block break-words text-[10px] text-amber-700">Warnings: {candidate.evidence.warnings.join(', ')}</span>}<span className="mt-1 block break-all font-mono text-[9px] text-slate-400">{candidate.medicineId}</span></span>
                      </label>)}
                      <label className={chosen === 'CREATE_NEW' ? 'flex cursor-pointer items-center gap-2 rounded-lg border border-indigo-400 bg-indigo-50 p-3' : 'flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 p-3 hover:bg-slate-50'}>
                        <input type="radio" name={'mapping-' + item.medicineId} checked={chosen === 'CREATE_NEW'} onChange={() => setChoices(value => ({ ...value, [item.medicineId]: 'CREATE_NEW' }))}/>
                        <span><strong className="block text-xs text-slate-800">Create new medicine record</strong><span className="text-[10px] text-slate-500">Use this only when none of the candidate records is the same medicine.</span></span>
                      </label>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Fields to approve ({selected.length})</p><div className="flex gap-2"><button type="button" onClick={() => setSelectedFields(value => ({ ...value, [item.medicineId]: (item.availableFields || []).map(field => field.key) }))} className="text-[10px] font-bold text-indigo-700">Select all</button><button type="button" onClick={() => setSelectedFields(value => ({ ...value, [item.medicineId]: [] }))} className="text-[10px] font-bold text-slate-500">Clear</button></div></div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {(item.availableFields || []).map(field => <label key={field.key} className="flex min-w-0 items-start gap-2 rounded-lg border border-slate-200 p-2 text-[10px]">
                        <input type="checkbox" checked={selected.includes(field.key)} onChange={event => setSelectedFields(value => ({ ...value, [item.medicineId]: event.target.checked ? [...selected, field.key] : selected.filter(key => key !== field.key) }))} className="mt-0.5"/>
                        <span className="min-w-0"><strong className="block text-slate-700">{labelFor(field.key)}</strong><span className="mt-0.5 block break-words text-slate-500">{displayValue(field.value).slice(0, 220)}</span></span>
                      </label>)}
                    </div>
                  </div>
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] leading-4 text-amber-900">Approval controls Store visibility and field mapping only. It does not independently verify clinical claims, prescription status, licensing or regulatory data.</p>
                  <div className="mt-3 flex justify-end"><button type="button" onClick={() => approve(item)} disabled={busyId === item.medicineId || !chosen || !selected.length} className="min-h-10 w-full rounded-lg bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-40 sm:w-auto">{busyId === item.medicineId ? 'Approving…' : 'Approve selected mapping'}</button></div>
                </>}
              </article>
            );
          })}
          {!loading && batchId && items.length > 0 && mappedCount === items.length && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4"><p className="text-xs font-bold text-indigo-900">This 100-record window is complete.</p><button type="button" onClick={nextBatch} className="mt-3 min-h-10 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-extrabold text-white">Load next 100 pending records</button></div>}
        </div>
        <footer className="flex shrink-0 justify-between gap-2 border-t bg-slate-50 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:p-4"><span className="self-center text-[10px] text-slate-500">Only approved mappings are returned to Store matching.</span><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">Close</button></footer>
      </section>
    </div>
  );
}
