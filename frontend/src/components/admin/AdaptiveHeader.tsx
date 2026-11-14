import React from 'react';
import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface SiblingOperationRef {
  id: string;
  title: string;
}

export interface AdaptiveHeaderProps {
  pageTitle: string;
  operationName?: string;
  breadcrumbs?: BreadcrumbItem[];
  backTo?: string;
  backLabel?: string;
  onBack?: () => void;
  prevOperation?: SiblingOperationRef | null;
  nextOperation?: SiblingOperationRef | null;
  siblingPositionLabel?: string;
  onSelectOperation?: (operationId: string) => void;
  rightSlot?: React.ReactNode;
}

function ArrowLeftIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export default function AdaptiveHeader({
  pageTitle,
  operationName,
  breadcrumbs,
  backTo = '/admin/operations',
  backLabel = 'Back to operations',
  onBack,
  prevOperation = null,
  nextOperation = null,
  siblingPositionLabel,
  onSelectOperation,
  rightSlot
}: AdaptiveHeaderProps) {
  const resolvedBreadcrumbs: BreadcrumbItem[] = breadcrumbs ?? [
    { label: 'Admin', to: '/' },
    { label: 'Operations', to: operationName ? '/admin/operations' : undefined },
    ...(operationName ? [{ label: operationName }] : [])
  ];

  const handleNavigateSibling = (target: SiblingOperationRef | null) => {
    if (!target || !onSelectOperation) return;
    onSelectOperation(target.id);
  };

  return (
    <header className="w-full flex flex-col">
      {/* Mobile & Tablet Sticky Header (< lg) */}
      <div className="flex lg:hidden sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 h-14 px-4 flex-row items-center justify-between gap-3">
        <div className="flex flex-row items-center gap-2 min-w-0 flex-1">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              className="min-h-11 min-w-11 flex flex-row items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 shrink-0"
            >
              <ArrowLeftIcon />
            </button>
          ) : (
            <Link
              to={backTo}
              aria-label={backLabel}
              className="min-h-11 min-w-11 flex flex-row items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 shrink-0"
            >
              <ArrowLeftIcon />
            </Link>
          )}
          <span className="text-sm font-semibold text-slate-900 truncate">
            {operationName || pageTitle}
          </span>
        </div>

        <div className="flex flex-row items-center gap-1 shrink-0">
          {(prevOperation || nextOperation) && (
            <div className="flex flex-row items-center gap-1">
              <button
                type="button"
                disabled={!prevOperation}
                onClick={() => handleNavigateSibling(prevOperation)}
                aria-label={prevOperation ? `Previous: ${prevOperation.title}` : 'No previous operation'}
                className="min-h-11 min-w-11 flex flex-row items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                disabled={!nextOperation}
                onClick={() => handleNavigateSibling(nextOperation)}
                aria-label={nextOperation ? `Next: ${nextOperation.title}` : 'No next operation'}
                className="min-h-11 min-w-11 flex flex-row items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <ChevronRightIcon />
              </button>
            </div>
          )}
          {rightSlot}
        </div>
      </div>

      {/* Desktop Breadcrumbs + Sibling Navigation (>= lg) */}
      <div className="hidden lg:flex flex-row items-center justify-between gap-4 bg-white border-b border-slate-200 px-6 py-3 shadow-xs">
        <nav aria-label="Breadcrumb" className="flex flex-row items-center gap-2 text-sm text-slate-600 min-w-0">
          {resolvedBreadcrumbs.map((crumb, index) => {
            const isLast = index === resolvedBreadcrumbs.length - 1;
            return (
              <React.Fragment key={`${crumb.label}-${index}`}>
                {index > 0 && (
                  <span className="text-slate-400 select-none" aria-hidden="true">
                    /
                  </span>
                )}
                {crumb.to && !isLast ? (
                  <Link
                    to={crumb.to}
                    className="min-h-11 min-w-11 flex flex-row items-center px-2.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                  >
                    <span>{crumb.label}</span>
                  </Link>
                ) : (
                  <span
                    className={`min-h-11 flex flex-row items-center px-2 truncate max-w-[340px] ${
                      isLast ? 'font-semibold text-slate-900' : 'text-slate-600'
                    }`}
                  >
                    {crumb.label}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="flex flex-row items-center gap-2 shrink-0">
          {rightSlot}
          {(prevOperation || nextOperation) && (
            <div className="flex flex-row items-center gap-2" role="group" aria-label="Sibling operation navigation">
              {siblingPositionLabel && (
                <span className="text-xs font-medium text-slate-500 tabular-nums px-2">
                  {siblingPositionLabel}
                </span>
              )}
              <button
                type="button"
                disabled={!prevOperation}
                onClick={() => handleNavigateSibling(prevOperation)}
                className="min-h-11 min-w-11 flex flex-row items-center justify-center gap-1.5 px-3.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-45 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <ChevronLeftIcon />
                <span>Previous Operation</span>
              </button>
              <button
                type="button"
                disabled={!nextOperation}
                onClick={() => handleNavigateSibling(nextOperation)}
                className="min-h-11 min-w-11 flex flex-row items-center justify-center gap-1.5 px-3.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-45 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <span>Next Operation</span>
                <ChevronRightIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
