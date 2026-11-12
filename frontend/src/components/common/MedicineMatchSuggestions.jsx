import React, { useEffect, useMemo, useState } from 'react';
import { fetchMedicineCatalog } from '../../api/medicineCatalogService';
import { rankMedicineTextMatches } from '../../utils/medicineScanMatching';

/**
 * Suggestions are deliberately advisory: selecting one is an explicit user
 * action. This component never adds a product to a cart or submits a request.
 */
export default function MedicineMatchSuggestions({ query, tenantId, catalogue = [], onSelect, title = 'Possible catalogue matches' }) {
  const [remoteCatalogue, setRemoteCatalogue] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const cleaned = String(query || '').trim();
    if (cleaned.length < 3 || !tenantId || catalogue.length) {
      setRemoteCatalogue([]);
      setError('');
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await fetchMedicineCatalog({ tenantId, page: 1, limit: 100, search: cleaned });
        let items = result.medicines || [];
        // A server's strict search may return nothing for a typo. A bounded
        // first-page catalogue fallback enables client-side typo suggestions.
        if (!items.length) {
          const fallback = await fetchMedicineCatalog({ tenantId, page: 1, limit: 100 });
          items = fallback.medicines || [];
        }
        if (!cancelled) setRemoteCatalogue(items);
      } catch (err) {
        if (!cancelled) {
          setRemoteCatalogue([]);
          setError(err?.message || 'Could not load catalogue suggestions.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, tenantId, catalogue.length]);

  const matches = useMemo(() => {
    const source = catalogue.length ? catalogue : remoteCatalogue;
    return rankMedicineTextMatches(query, source).alternatives;
  }, [query, catalogue, remoteCatalogue]);

  if (String(query || '').trim().length < 3 || (!loading && !matches.length && !error)) return null;
  return (
    <section className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 space-y-2" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold text-indigo-950">{title}</p>
        {loading && <span className="text-[10px] text-indigo-700">Searching catalogue…</span>}
      </div>
      {error && <p className="text-[10px] text-amber-700">{error}</p>}
      {matches.map(({ product, score, reasons }) => (
        <button
          key={String(product.productId || product._id || product.medicineId || product.sku || product.name)}
          type="button"
          onClick={() => onSelect?.(product)}
          className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-left hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold text-slate-900">{product.name || product.productName || product.brandName || product.genericName}</span>
              <span className="mt-0.5 block text-[10px] text-slate-600">{[product.strength, product.dosageForm || product.form, product.manufacturer || product.brandName].filter(Boolean).join(' · ') || 'Details need verification'}</span>
              <span className="mt-1 block text-[9px] text-amber-700">{reasons.join(' · ') || 'Check product details before selecting'}</span>
            </span>
            <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[9px] font-bold text-indigo-800">{score}% similar</span>
          </span>
        </button>
      ))}
      <p className="text-[9px] leading-relaxed text-slate-500">Suggestions only. Verify medicine name, strength, dosage form and pack before selecting. Nothing is ordered or requested until you confirm.</p>
    </section>
  );
}
