import React, { useState, useEffect } from 'react';
import { getReadableErrorMessage } from '../utils/errorMessage';
import apiClient from '../api/apiClient';
import { useLanguage } from '../context/LanguageContext';

const asText = value => typeof value === 'string' ? value : '';
const safeSources = value => Array.isArray(value)
  ? value.filter(item => item && typeof item === 'object' && typeof item.uri === 'string' && /^https?:\/\//i.test(item.uri))
  : [];

export default function SearchGroundingInfo({ searchQuery }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const trimmed = (searchQuery || '').trim();
    if (trimmed.length < 3) {
      setData(null);
      setError('');
      setLoading(false);
      setExpanded(false);
      return undefined;
    }

    let active = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await apiClient.post('/api/med-search-grounding', { query: trimmed }, {
          ...(controller ? { signal: controller.signal } : {})
        });
        if (active) {
          const payload = response?.data && typeof response.data === 'object' ? response.data : {};
          setData({ summary: asText(payload.summary), sources: safeSources(payload.sources) });
          setExpanded(false);
        }
      } catch (err) {
        if (active && err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          setData(null);
          setError(getReadableErrorMessage(err, 'Medical information is temporarily unavailable. Please try again.'));
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 650);

    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [searchQuery]);

  if (!searchQuery || searchQuery.trim().length < 3) return null;

  const summary = asText(data?.summary);
  const sources = safeSources(data?.sources);

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-3.5 py-3 sm:px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-extrabold text-slate-900 dark:text-white sm:text-sm">{t('realTimeMedicalGrounding')}</h4>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{t('medicineInfoFor').replace('{query}', searchQuery)}</p>
        </div>
        <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} disabled={loading || (!data && !error)} className="shrink-0 rounded-lg px-2.5 py-2 text-[11px] font-bold text-blue-700 transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-50 dark:text-blue-300 dark:hover:bg-slate-800">
          {expanded ? t('hideDetails') : t('showDetails')} <span className="ml-1" aria-hidden="true">{expanded ? '↑' : '↓'}</span>
        </button>
      </div>
      {loading && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800" role="status" aria-live="polite">
          <div className="mb-2 h-2.5 w-2/5 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mb-2 h-2.5 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-2.5 w-4/5 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          <span className="sr-only">Fetching medical information…</span>
        </div>
      )}
      {error && !loading && (
        <div className="flex items-start gap-2.5 border-t border-amber-100 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200" role="status">
          <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3h.01" /></svg>
          <p className="min-w-0 leading-relaxed">{error}</p>
        </div>
      )}
      {expanded && !loading && data && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          {summary ? <p className="whitespace-pre-line text-xs leading-6 text-slate-700 dark:text-slate-200 sm:text-[13px]">{summary}</p> : <p className="text-xs text-slate-500">No additional summary is available for this search.</p>}
          {sources.length > 0 && (
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{t('informationSources')}</p>
              <div className="flex flex-wrap gap-2">
                {sources.map((source, index) => (
                  <a key={source.uri} href={source.uri} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 transition hover:border-blue-200 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-300">
                    <span className="truncate">{asText(source.title) || `Source ${index + 1}`}</span>
                    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3h7v7m0-7L10 14" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <p className="px-4 pb-3 text-[10px] leading-relaxed text-slate-400">Informational support only. Confirm medicine use and dosage with a qualified pharmacist or clinician.</p>
    </section>
  );
}
