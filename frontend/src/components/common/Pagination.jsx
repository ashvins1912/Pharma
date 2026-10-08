import React from 'react';

const getPages = (page, totalPages) => {
  const total = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(1, Number(page) || 1), total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis-right', total];
  if (current >= total - 3) return [1, 'ellipsis-left', total - 4, total - 3, total - 2, total - 1, total];
  return [1, 'ellipsis-left', current - 1, current, current + 1, 'ellipsis-right', total];
};

export default function Pagination({
  page = 1,
  totalPages = 0,
  total = 0,
  pageSize = 10,
  onPageChange,
  loading = false,
  label = 'records',
  className = ''
}) {
  const pages = getPages(page, totalPages);
  if (Number(total) <= Number(pageSize) || Number(totalPages) <= 1) return null;

  const current = Math.max(1, Number(page) || 1);
  const totalPageCount = Math.max(1, Number(totalPages) || 1);
  const first = total > 0 ? ((current - 1) * pageSize) + 1 : 0;
  const last = Math.min(current * pageSize, total);

  const go = nextPage => {
    const target = Math.min(Math.max(1, nextPage), totalPageCount);
    if (target !== current && !loading) onPageChange?.(target);
  };

  return (
    <nav className={`flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between ${className}`} aria-label={`${label} pagination`}>
      <span className="text-[10px] font-semibold text-slate-500">
        {first}–{last} of {total} {label}
      </span>
      <div className="flex items-center gap-1" role="group" aria-label="Pagination controls">
        <button type="button" onClick={() => go(current - 1)} disabled={current <= 1 || loading}
          className="h-7 min-w-7 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Previous page">‹</button>
        {pages.map((item, index) => item === 'ellipsis-left' || item === 'ellipsis-right'
          ? <span key={item} className="flex h-7 min-w-5 items-center justify-center text-[10px] font-bold text-slate-400">…</span>
          : <button key={item} type="button" onClick={() => go(item)} disabled={loading}
              aria-current={item === current ? 'page' : undefined}
              className={`h-7 min-w-7 rounded-lg px-2 text-[10px] font-black transition ${item === current
                ? 'bg-blue-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'} disabled:opacity-50`}>
              {item}
            </button>
        )}
        <button type="button" onClick={() => go(current + 1)} disabled={current >= totalPageCount || loading}
          className="h-7 min-w-7 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-black text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Next page">›</button>
      </div>
    </nav>
  );
}
