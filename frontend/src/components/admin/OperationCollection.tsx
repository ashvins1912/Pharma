import React from 'react';
import {
  AdminOperationRecord,
  OperationCategory,
  OperationViewMode,
  getStatusPillClasses
} from '../../types/adminOperations';

export interface OperationCollectionProps {
  operations: AdminOperationRecord[];
  view: OperationViewMode;
  onViewChange: (nextView: OperationViewMode) => void;
  isLoading?: boolean;
  onSelectOperation: (operation: AdminOperationRecord) => void;
  onResetFilters?: () => void;
  toolbarLeft?: React.ReactNode;
}

function GridIcon() {
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
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon() {
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
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function CategoryBadgeIcon({ category }: { category: OperationCategory }) {
  switch (category) {
    case 'Fulfillment':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      );
    case 'Inventory':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
      );
    case 'Compliance':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'Security':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'Billing':
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="20" height="14" x="2" y="5" rx="2" />
          <path d="M2 10h20" />
        </svg>
      );
  }
}

function CollectionSkeleton({ view }: { view: OperationViewMode }) {
  if (view === 'list') {
    return (
      <div
        aria-label="Loading operations list"
        className="flex flex-col bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden shadow-xs"
      >
        {[0, 1, 2, 3, 4].map(item => (
          <div
            key={item}
            className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 animate-pulse"
          >
            <div className="flex flex-row items-center gap-3 flex-1 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-slate-100 shrink-0" />
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="h-4 w-48 rounded bg-slate-100" />
                <div className="h-3 w-72 rounded bg-slate-100" />
              </div>
            </div>
            <div className="flex flex-row items-center gap-3 shrink-0">
              <div className="h-6 w-20 rounded-full bg-slate-100" />
              <div className="h-11 w-24 rounded-lg bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div aria-label="Loading operations grid" className="flex flex-row flex-wrap gap-4">
      {[0, 1, 2, 3, 4, 5].map(item => (
        <div
          key={item}
          className="w-full md:w-[calc(50%-8px)] xl:w-[calc(33.333%-11px)] bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 shadow-xs animate-pulse"
        >
          <div className="flex flex-row items-center justify-between gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-100" />
            <div className="h-6 w-24 rounded-full bg-slate-100" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-4 w-3/4 rounded bg-slate-100" />
            <div className="h-10 w-full rounded bg-slate-100" />
          </div>
          <div className="pt-3 border-t border-slate-100 flex flex-row items-center justify-between gap-2">
            <div className="h-3 w-28 rounded bg-slate-100" />
            <div className="h-11 w-24 rounded-lg bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OperationCollection({
  operations,
  view,
  onViewChange,
  isLoading = false,
  onSelectOperation,
  onResetFilters,
  toolbarLeft
}: OperationCollectionProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: Search/Filters + Segmented Grid/List Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-row flex-wrap items-center gap-3 flex-1 min-w-0">
          {toolbarLeft}
        </div>

        <div
          role="group"
          aria-label="Collection view layout"
          className="bg-slate-100 p-1 rounded-lg flex flex-row items-center gap-1 self-start sm:self-auto shrink-0"
        >
          <button
            type="button"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
            className={`min-h-11 min-w-11 flex flex-row items-center justify-center gap-2 px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
              view === 'grid'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
            }`}
          >
            <GridIcon />
            <span>Grid</span>
          </button>

          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
            className={`min-h-11 min-w-11 flex flex-row items-center justify-center gap-2 px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
              view === 'list'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
            }`}
          >
            <ListIcon />
            <span>List</span>
          </button>
        </div>
      </div>

      {/* Loading / Empty / Data Collection */}
      {isLoading ? (
        <CollectionSkeleton view={view} />
      ) : operations.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3 shadow-xs">
          <p className="text-base font-semibold text-slate-900">
            No matching operations found
          </p>
          <p className="text-sm text-slate-600 max-w-md">
            Adjust your search keywords or category filters to inspect other dispensary operations.
          </p>
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="min-h-11 min-w-11 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>Reset filters</span>
            </button>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="flex flex-row flex-wrap gap-4">
          {operations.map(op => (
            <article
              key={op.id}
              className="w-full md:w-[calc(50%-8px)] xl:w-[calc(33.333%-11px)] bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-4 hover:border-blue-300 transition-colors shadow-xs"
            >
              {/* Top Row: Category Icon Badge + Status Pill */}
              <div className="flex flex-row items-center justify-between gap-2">
                <div className="flex flex-row items-center gap-2 min-w-0">
                  <div className="bg-blue-50 text-blue-600 p-2 rounded-lg flex flex-row items-center justify-center shrink-0">
                    <CategoryBadgeIcon category={op.category} />
                  </div>
                  <span className="text-xs font-medium text-slate-600 truncate">
                    {op.category}
                  </span>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 ${getStatusPillClasses(op.status)}`}
                >
                  {op.status}
                </span>
              </div>

              {/* Middle Block: Title + Description */}
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-slate-900 line-clamp-1">
                  {op.title}
                </h3>
                <p className="text-sm text-slate-600 line-clamp-2 min-h-[40px]">
                  {op.description}
                </p>
              </div>

              {/* Bottom Footer: Assignee / Timestamp + Explicit Action */}
              <div className="pt-3 border-t border-slate-100 flex flex-row items-center justify-between gap-3">
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-slate-600 truncate">
                    {op.assignee}
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums truncate">
                    {op.updatedAt}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectOperation(op)}
                  className="min-h-11 min-w-11 px-3 rounded-lg flex flex-row items-center justify-center text-sm font-medium text-blue-600 hover:bg-blue-50 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <span>Inspect</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex flex-col bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden shadow-xs">
          {operations.map(op => (
            <article
              key={op.id}
              className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex flex-row items-start md:items-center gap-3 flex-1 min-w-0">
                <div className="bg-blue-50 text-blue-600 p-2 rounded-lg flex flex-row items-center justify-center shrink-0">
                  <CategoryBadgeIcon category={op.category} />
                </div>

                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <div className="flex flex-row flex-wrap items-center gap-2 min-w-0">
                    <h3 className="text-base font-semibold text-slate-900 line-clamp-1">
                      {op.title}
                    </h3>
                    <span className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                      {op.code}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 line-clamp-1">
                    {op.description}
                  </p>
                </div>
              </div>

              <div className="flex flex-row flex-wrap md:flex-nowrap items-center justify-between md:justify-end gap-3 shrink-0">
                <div className="flex flex-col md:items-end min-w-0">
                  <span className="text-xs font-medium text-slate-600 truncate">
                    {op.assignee}
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {op.updatedAt}
                  </span>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 ${getStatusPillClasses(op.status)}`}
                >
                  {op.status}
                </span>

                <button
                  type="button"
                  onClick={() => onSelectOperation(op)}
                  className="min-h-11 min-w-11 px-3.5 rounded-lg flex flex-row items-center justify-center text-sm font-medium text-blue-600 hover:bg-blue-50 whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                >
                  <span>Inspect</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
