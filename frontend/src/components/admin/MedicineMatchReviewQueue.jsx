import React, { useCallback, useEffect, useState } from 'react';
import { getReadableErrorMessage } from '../../utils/errorMessage';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';

const FIELDS = [
  ['brandName', 'Brand name'], ['productName', 'Product name'], ['genericName', 'Generic name'], ['genericId', 'Generic ID'],
  ['composition', 'Composition'], ['ingredients', 'Ingredients'], ['ingredientIds', 'Ingredient IDs'], ['ingredientDetails', 'Ingredient details'],
  ['strength', 'Strength'], ['dosageForm', 'Dosage form'], ['drugFormId', 'Drug form ID'], ['packSize', 'Pack size'], ['medicineType', 'Medicine type'],
  ['manufacturer', 'Manufacturer'], ['manufacturerId', 'Manufacturer ID'], ['productId', 'Product ID'],
  ['therapeuticClass', 'Therapeutic class'], ['chemicalClass', 'Chemical class'], ['actionClass', 'Action class'],
  ['routes', 'Routes'], ['routeIds', 'Route IDs'], ['indications', 'Indications'], ['uses', 'Uses'],
  ['contraindications', 'Contraindications'], ['sideEffects', 'Side effects'], ['drugInteractions', 'Drug interactions'],
  ['alternatives', 'Alternatives'], ['suggestedAlternatives', 'Suggested alternatives'], ['habitForming', 'Habit forming'],
  ['requiresPrescription', 'Prescription required'], ['prescriptionVerification', 'Prescription verification'],
  ['clinicalDataVerification', 'Clinical verification'], ['sourceLicenseStatus', 'Source licence status'],
  ['sourceLicenseStatusValue', 'Source licence value'], ['casNumbers', 'CAS numbers'], ['uniiCodes', 'UNII codes'],
  ['substanceDescriptions', 'Substance descriptions'], ['molecularFormulas', 'Molecular formulas'], ['inchiValues', 'InChI values'],
  ['iupacNames', 'IUPAC names'], ['molecularWeights', 'Molecular weights'], ['smiles', 'SMILES'], ['toxicology', 'Toxicology'],
  ['sourceImageUrl', 'Source image URL'], ['dataQualityStatus', 'Data quality status'], ['qualityScore', 'Quality score'],
  ['qualityGrade', 'Quality grade'], ['qualityIssues', 'Quality issues'], ['sourcePriority', 'Source priority'],
  ['sourceDatasets', 'Source datasets'], ['sourceRecordIds', 'Source record IDs'], ['legacyMedicineIds', 'Legacy medicine IDs'],
  ['lastVerifiedAt', 'Last verified at']
];
const hasValue = value => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
const display = value => Array.isArray(value) ? value.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(', ') : value && typeof value === 'object' ? JSON.stringify(value) : value === true ? 'Yes' : value === false ? 'No' : String(value ?? '—');

export default function MedicineMatchReviewQueue() {
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [drafts, setDrafts] = useState({});
  const [searches, setSearches] = useState({});
  const [results, setResults] = useState({});
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryCursor, setDiscoveryCursor] = useState('');
  const [discoveryComplete, setDiscoveryComplete] = useState(false);
  const [discoverySummary, setDiscoverySummary] = useState(null);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const response = await apiClient.get('/api/v1/inventory/catalogue/matches/review', { params: { page, limit: 100, status: 'PENDING' } });
      setItems(response.data?.items || []);
      setPagination(response.data?.pagination || { page, total: 0, totalPages: 0 });
    } catch (error) {
      addToast(getReadableErrorMessage(error, 'Could not load possible catalogue matches.'), 'error');
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { void load(1); }, [load]);

  const discoverExistingProducts = async () => {
    if (discovering || discoveryComplete) return;
    setDiscovering(true);
    try {
      const response = await apiClient.post('/api/v1/inventory/catalogue/matches/discover', {
        afterId: discoveryCursor || undefined, limit: 500
      });
      const result = response.data || {};
      setDiscoveryCursor(result.nextCursor || discoveryCursor);
      setDiscoveryComplete(!result.hasMore);
      setDiscoverySummary(current => ({
        scanned: Number(current?.scanned || 0) + Number(result.scanned || 0),
        queued: Number(current?.queued || 0) + Number(result.queued || 0),
        skipped: Number(current?.skipped || 0) + Number(result.skipped || 0),
        hasMore: Boolean(result.hasMore)
      }));
      addToast(result.hasMore
        ? `Scanned ${result.scanned || 0} existing products. Continue to discover the next batch.`
        : `Discovery complete. ${Number(result.scanned || 0)} products scanned in the final batch.`, 'success');
      await load(1);
    } catch (error) {
      addToast(getReadableErrorMessage(error, 'Could not discover existing Store products.'), 'error');
    } finally { setDiscovering(false); }
  };

  const updateDraft = (id, patch) => setDrafts(current => ({ ...current, [id]: { ...(current[id] || {}), ...patch } }));
  const openReview = row => {
    const id = row.identityHash;
    setActiveId(activeId === id ? '' : id);
    if (!drafts[id]) {
      const target = row.candidate || null;
      const fields = target ? FIELDS.map(([key]) => key).filter(key => hasValue(target[key])) : [];
      updateDraft(id, { medicineId: target?.medicineId || '', target, fields });
    }
  };
  const searchCatalogue = async row => {
    const id = row.identityHash;
    const query = String(searches[id] || '').trim();
    if (!query) return;
    try {
      const response = await apiClient.get('/api/v1/inventory/catalogue/medicines', { params: { search: query, page: 1, limit: 10 } });
      setResults(current => ({ ...current, [id]: response.data?.items || [] }));
    } catch (error) {
      addToast(getReadableErrorMessage(error, 'Could not search the Medicine Master catalogue.'), 'error');
    }
  };
  const chooseTarget = (id, medicine) => {
    const fields = FIELDS.map(([key]) => key).filter(key => hasValue(medicine[key]));
    updateDraft(id, { medicineId: medicine.medicineId, target: medicine, fields });
    setResults(current => ({ ...current, [id]: [] }));
  };
  const loadSuggestedTarget = async (row, medicineId) => {
    try {
      const response = await apiClient.get(`/api/v1/inventory/catalogue/medicines/${encodeURIComponent(medicineId)}`);
      const medicine = response.data?.medicine;
      if (medicine) chooseTarget(row.identityHash, medicine);
    } catch (error) { addToast(getReadableErrorMessage(error, 'Could not load the suggested catalogue record.'), 'error'); }
  };

  const approve = async row => {
    const draft = drafts[row.identityHash] || {};
    if (!draft.medicineId || !draft.fields?.length || saving) return;
    setSaving(true);
    try {
      await apiClient.post(`/api/v1/inventory/catalogue/matches/${encodeURIComponent(row.identityHash)}/map`, {
        medicineId: draft.medicineId, fields: draft.fields
      });
      addToast('Catalogue mapping approved. Store details will now use only the selected mapped fields.', 'success');
      setActiveId('');
      setDrafts(current => { const next = { ...current }; delete next[row.identityHash]; return next; });
      await load(items.length === 1 && pagination.page > 1 ? pagination.page - 1 : (pagination.page || 1));
    } catch (error) {
      addToast(getReadableErrorMessage(error, 'Could not approve this catalogue mapping.'), 'error');
    } finally { setSaving(false); }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 bg-violet-50/70 px-4 py-4">
        <div><h3 className="text-sm font-black text-slate-900">Possible catalogue matches · Admin mapping</h3><p className="mt-1 text-xs text-slate-600">Review up to 100 product identities per page. Select a master record and explicitly approve the fields Store may display.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={discoverExistingProducts} disabled={discovering || discoveryComplete} className="min-h-10 rounded-lg bg-violet-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">{discovering ? 'Scanning products…' : discoveryComplete ? 'Discovery complete' : discoveryCursor ? 'Scan next 500 products' : 'Discover existing Store products'}</button>
          <button type="button" onClick={() => load(pagination.page || 1)} disabled={loading} className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-50">{loading ? "Refreshing…" : "Refresh queue"}</button>
        </div>
        <div className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-right"><strong className="block text-lg tabular-nums text-violet-800">{Number(pagination.total || 0).toLocaleString()}</strong><span className="text-[10px] font-bold uppercase text-slate-500">Awaiting mapping</span></div>
      </header>
      {discoverySummary && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-violet-100 bg-violet-50/40 px-4 py-2 text-[11px] text-slate-600"><strong className="text-violet-800">Existing product discovery</strong><span>{discoverySummary.scanned.toLocaleString()} scanned</span><span>{discoverySummary.queued.toLocaleString()} added to queue</span><span>{discoverySummary.skipped.toLocaleString()} skipped (no usable medicine name)</span><span className="font-bold">{discoverySummary.hasMore ? 'More batches available' : 'Scan complete'}</span></div>}
      {loading ? <p className="p-6 text-center text-sm text-slate-500">Loading review queue…</p> : items.length ? <div className="divide-y divide-slate-100">
        {items.map(row => {
          const draft = drafts[row.identityHash] || {};
          const isOpen = activeId === row.identityHash;
          const selected = draft.target || (results[row.identityHash] || []).find(item => item.medicineId === draft.medicineId) || row.candidate;
          return <article key={row.identityHash} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-slate-900">{row.input?.brand || row.input?.name || row.input?.genericName || 'Unnamed product'}</strong><span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase text-amber-800">{row.status || 'PENDING'}</span>{row.confidence > 0 && <span className="text-[10px] font-bold text-slate-500">{row.confidence}% candidate confidence</span>}</div>
                <p className="mt-1 break-words text-xs text-slate-600">{[row.input?.genericName, row.input?.composition, row.input?.strength, row.input?.dosageForm || row.input?.form].filter(Boolean).join(' · ') || 'No additional product details supplied'}</p>
                <p className="mt-1 break-all font-mono text-[9px] text-slate-400">{row.identityHash}</p>
              </div>
              <button type="button" onClick={() => openReview(row)} className="min-h-10 shrink-0 rounded-lg border border-violet-200 px-3 py-2 text-xs font-extrabold text-violet-700 hover:bg-violet-50">{isOpen ? 'Close mapping' : 'Review mapping'}</button>
            </div>
            {isOpen && <div className="mt-4 space-y-4 rounded-xl border border-violet-100 bg-slate-50 p-3 sm:p-4">
              <div><label className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">Find the correct Medicine Master record</label><div className="flex gap-2"><input value={searches[row.identityHash] || ''} onChange={event => setSearches(current => ({ ...current, [row.identityHash]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') searchCatalogue(row); }} placeholder="Search brand, generic or composition" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"/><button type="button" onClick={() => searchCatalogue(row)} className="rounded-lg bg-indigo-700 hover:bg-indigo-800 px-3 py-2 text-xs font-bold text-white transition">Search</button></div>
                {(results[row.identityHash] || []).length > 0 && <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-lg border bg-white p-2">{results[row.identityHash].map(medicine => <button key={medicine.medicineId} type="button" onClick={() => chooseTarget(row.identityHash, medicine)} className="block w-full rounded-lg p-2 text-left hover:bg-violet-50"><strong className="block text-xs text-slate-900">{medicine.brandName || medicine.productName}</strong><span className="text-[10px] text-slate-600">{[medicine.genericName, medicine.composition, medicine.strength, medicine.dosageForm].filter(Boolean).join(' · ')}</span><span className="block font-mono text-[9px] text-slate-400">{medicine.medicineId}</span></button>)}</div>}
              </div>
              {row.candidates?.length > 0 && <div><p className="mb-2 text-[10px] font-black uppercase text-slate-500">Algorithm suggestions · verify before mapping</p><div className="flex flex-wrap gap-2">{row.candidates.map(candidate => <button key={candidate.medicineId} type="button" onClick={() => loadSuggestedTarget(row, candidate.medicineId)} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-[10px] hover:bg-amber-50"><strong className="block text-slate-800">{candidate.brandName || candidate.productName || candidate.medicineId}</strong><span className="text-slate-500">{candidate.score ?? row.confidence ?? 0}% · {candidate.matchReason || 'candidate'}</span></button>)}</div></div>}
              {selected && <div className="rounded-lg border border-emerald-200 bg-white p-3"><p className="text-[10px] font-black uppercase text-emerald-700">Selected target</p><strong className="mt-1 block text-sm text-slate-900">{selected.brandName || selected.productName}</strong><p className="mt-1 text-xs text-slate-600">{[selected.genericName, selected.composition, selected.strength, selected.dosageForm].filter(Boolean).join(' · ')}</p><p className="mt-1 font-mono text-[9px] text-slate-400">{selected.medicineId}</p></div>}
              <div><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-xs font-black text-slate-800">Fields allowed in Store</h4><p className="mt-1 text-[10px] text-slate-500">Only checked, populated fields are returned by the public product-detail match.</p></div><button type="button" onClick={() => updateDraft(row.identityHash, { fields: selected ? FIELDS.map(([key]) => key).filter(key => hasValue(selected[key])) : [] })} disabled={!selected} className="text-[10px] font-bold text-violet-700 disabled:opacity-40">Select all available</button></div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{FIELDS.map(([key, label]) => <label key={key} className={`flex min-w-0 items-start gap-2 rounded-lg border bg-white p-2 text-[10px] ${hasValue(selected?.[key]) ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}><input type="checkbox" checked={(draft.fields || []).includes(key)} disabled={!selected || !hasValue(selected[key])} onChange={event => updateDraft(row.identityHash, { fields: event.target.checked ? [...(draft.fields || []), key] : (draft.fields || []).filter(field => field !== key) })} className="mt-0.5"/><span className="min-w-0"><strong className="block text-slate-700">{label}</strong><span className="mt-0.5 block break-words text-slate-500">{selected && hasValue(selected[key]) ? display(selected[key]) : 'Not available'}</span></span></label>)}</div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3"><p className="text-[10px] text-slate-500">{draft.fields?.length || 0} fields selected · mapping is audited with admin and timestamp</p><button type="button" onClick={() => approve(row)} disabled={saving || !draft.medicineId || !draft.fields?.length} className="min-h-10 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-40">{saving ? 'Approving…' : 'Approve selected mapping'}</button></div>
            </div>}
          </article>;
        })}
      </div> : <p className="p-6 text-center text-sm text-slate-500">{pagination.total ? 'No pending mappings on this page.' : 'No possible matches are waiting for admin mapping.'}</p>}
      <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><span className="text-[11px] text-slate-500">Page {pagination.page || 1} of {Math.max(1, pagination.totalPages || 1)} · 100 per batch</span><div className="flex gap-2"><button type="button" disabled={loading || pagination.page <= 1} onClick={() => load(pagination.page - 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Previous</button><button type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => load(pagination.page + 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Next 100</button></div></footer>
    </section>
  );
}
