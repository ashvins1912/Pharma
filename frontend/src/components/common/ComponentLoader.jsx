import React from 'react';

/**
 * Senior UX Architecture: Versatile Responsive Loader & Skeleton UI Component Suite
 * Tailored for multiple screen sizes (mobile <640px, tablet 640-1024px, desktop 1024px+).
 * Supports light & dark modes with strict WCAG AA contrast and zero layout shift.
 */

/**
 * 1. Inline Spinner for buttons, micro-indicators and badges
 */
export function InlineSpinner({
  size = 'sm',
  color = 'currentColor',
  className = '',
  label = 'Loading...'
}) {
  const sizeMap = {
    xs: 'w-3 h-3 border-[1.5px]',
    sm: 'w-4 h-4 border-2',
    md: 'w-5 h-5 border-2',
    lg: 'w-6 h-6 border-[2.5px]'
  };

  const ringSize = sizeMap[size] || sizeMap.sm;

  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
    >
      <span
        style={{ borderColor: color, borderTopColor: 'transparent' }}
        className={`${ringSize} rounded-full animate-spin`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * 2. ComponentLoader: Container-level loader for nested views, tabs, and panels
 */
export function ComponentLoader({
  title = 'Loading data…',
  subtitle = 'Please wait while we sync the latest information.',
  variant = 'spinner', // 'spinner' | 'pulse' | 'minimal'
  minHeight = 'min-h-[220px]',
  className = ''
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full flex flex-col items-center justify-center p-6 sm:p-8 md:p-12 text-center rounded-3xl bg-white/60 dark:bg-gray-900/60 border border-slate-200/80 dark:border-gray-800/80 backdrop-blur-xs transition-all ${minHeight} ${className}`}
    >
      {variant === 'spinner' && (
        <div className="relative mb-4">
          <div className="w-12 h-12 rounded-full border-4 border-blue-600/20 dark:border-blue-400/20" />
          <div className="w-12 h-12 rounded-full border-4 border-blue-600 dark:border-blue-400 border-t-transparent animate-spin absolute inset-0" />
        </div>
      )}

      {variant === 'pulse' && (
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 rounded-full bg-blue-600 dark:bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
          <div className="w-3 h-3 rounded-full bg-blue-600 dark:bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
          <div className="w-3 h-3 rounded-full bg-blue-600 dark:bg-blue-400 animate-bounce" />
        </div>
      )}

      {variant === 'minimal' && (
        <InlineSpinner size="md" className="text-blue-600 dark:text-blue-400 mb-3" />
      )}

      <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 tracking-tight">
        {title}
      </h4>
      {subtitle && (
        <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/**
 * 3. CardSkeleton: Responsive grid of animated placeholder cards
 */
export function CardSkeleton({
  count = 6,
  columns = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  className = ''
}) {
  return (
    <div
      role="status"
      aria-label="Loading content cards"
      className={`grid ${columns} gap-3 sm:gap-4 w-full animate-pulse ${className}`}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200/80 dark:border-gray-800 bg-white dark:bg-gray-900/80 space-y-3.5 shadow-xs"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-200 dark:bg-gray-800 shrink-0" />
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="h-3.5 bg-slate-200 dark:bg-gray-800 rounded-md w-3/4" />
                <div className="h-2.5 bg-slate-100 dark:bg-gray-800/60 rounded-md w-1/2" />
              </div>
            </div>
            <div className="w-14 h-5 bg-slate-200 dark:bg-gray-800 rounded-full shrink-0" />
          </div>

          <div className="space-y-2 pt-1">
            <div className="h-2.5 bg-slate-100 dark:bg-gray-800/60 rounded-md w-full" />
            <div className="h-2.5 bg-slate-100 dark:bg-gray-800/60 rounded-md w-4/5" />
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-gray-800/80 flex items-center justify-between">
            <div className="h-3 bg-slate-200 dark:bg-gray-800 rounded-md w-16" />
            <div className="h-6 bg-slate-200 dark:bg-gray-800 rounded-lg w-20" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading cards...</span>
    </div>
  );
}

/**
 * 4. TableSkeleton: Structured tabular skeleton matching tables
 */
export function TableSkeleton({
  rows = 5,
  columns = 5,
  className = ''
}) {
  return (
    <div
      role="status"
      aria-label="Loading data table"
      className={`w-full overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xs animate-pulse ${className}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-gray-800 bg-slate-50/70 dark:bg-gray-800/50">
              {Array.from({ length: columns }).map((_, colIdx) => (
                <th key={colIdx} className="py-3 px-3 sm:px-4">
                  <div className="h-3 bg-slate-200 dark:bg-gray-700 rounded-md w-16 sm:w-24" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-slate-50/40">
                {Array.from({ length: columns }).map((_, colIdx) => (
                  <td key={colIdx} className="py-3.5 px-3 sm:px-4">
                    <div
                      className={`h-3 rounded-md bg-slate-200/80 dark:bg-gray-800 ${
                        colIdx === 0
                          ? 'w-24 sm:w-36'
                          : colIdx === columns - 1
                          ? 'w-12 sm:w-16 ml-auto'
                          : 'w-16 sm:w-20'
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="sr-only">Loading table data...</span>
    </div>
  );
}

/**
 * 5. EmptyState: Clean, accessible zero-data component
 */
export function EmptyState({
  icon = '📦',
  title = 'No items found',
  description = 'There is no data to display for this view currently.',
  actionLabel = null,
  onAction = null,
  className = ''
}) {
  return (
    <div
      role="region"
      aria-label={title}
      className={`w-full flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-3xl bg-slate-50/60 dark:bg-gray-900/40 border border-dashed border-slate-200 dark:border-gray-800 space-y-3 ${className}`}
    >
      <span className="text-3xl sm:text-4xl select-none" aria-hidden="true">
        {icon}
      </span>
      <div className="space-y-1 max-w-md">
        <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100">
          {title}
        </h4>
        {description && (
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * 6. ErrorState: Clean, accessible error container
 */
export function ErrorState({
  title = 'Failed to load data',
  message = 'An unexpected network or server error occurred.',
  onRetry = null,
  className = ''
}) {
  return (
    <div
      role="alert"
      className={`w-full p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/20 text-rose-900 dark:text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${className}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-xl sm:text-2xl shrink-0" aria-hidden="true">
          ⚠️
        </span>
        <div className="space-y-0.5 min-w-0">
          <h4 className="text-xs sm:text-sm font-black text-rose-950 dark:text-rose-100">
            {title}
          </h4>
          <p className="text-xs text-rose-800 dark:text-rose-300 break-words leading-relaxed">
            {message}
          </p>
        </div>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs rounded-xl transition cursor-pointer shadow-xs hover:scale-105"
        >
          Retry ↻
        </button>
      )}
    </div>
  );
}

export default ComponentLoader;
