import React, { useState, useEffect } from 'react';
import apiClient from '../api/apiClient';
import { useLanguage } from '../context/LanguageContext';

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
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await apiClient.post('/api/med-search-grounding', { query: trimmed });
        if (active) {
          setData(res.data);
          setExpanded(true);
        }
      } catch (err) {
        if (active) {
          setError(err?.response?.data?.error || err.message || 'Could not fetch real-time medical search grounding.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 600); // 600ms debounce

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  if (!searchQuery || searchQuery.trim().length < 3) return null;

  return (
    <div className="mt-3 rounded-2xl border border-blue-200 dark:border-blue-900 bg-gradient-to-br from-blue-50/80 via-white to-emerald-50/50 dark:from-slate-900 dark:to-slate-900 p-4 shadow-sm transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xs shadow-sm">
            🌐
          </span>
          <div>
            <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
              <span>{t('realTimeMedicalGrounding')}</span>
              <span className="text-[9px] font-black uppercase bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                Google Search AI
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Live medical literature, usage guidelines, and pharmacy availability for &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline px-2 py-1"
        >
          {expanded ? `${t('hideDetails')} ▲` : `${t('showDetails')} ▼`}
        </button>
      </div>

      {loading && (
        <div className="mt-3 space-y-2 animate-pulse">
          <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-full"></div>
          <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-4/5"></div>
          <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-2/3"></div>
        </div>
      )}

      {error && !loading && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400 font-bold">{error}</p>
      )}

      {expanded && data && !loading && (
        <div className="mt-3 space-y-3 pt-3 border-t border-blue-100 dark:border-slate-800 animate-fade-in">
          <div className="text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line font-medium">
            {data.summary}
          </div>

          {Array.isArray(data.sources) && data.sources.length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">
                Verified Grounding Sources:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.sources.map((src, idx) => (
                  <a
                    key={idx}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 px-2.5 py-1 rounded-xl transition border border-blue-200 dark:border-blue-900"
                  >
                    <span>🔗</span>
                    <span className="truncate max-w-[220px]">{src.title || src.uri}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
