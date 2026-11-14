import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface ScrollSafeTabDefinition {
  id: string;
  label: string;
  count?: number;
  renderPanel: () => React.ReactNode;
}

export interface ScrollSafeTabsProps {
  tabs: ScrollSafeTabDefinition[];
  paramKey?: string;
  defaultTabId?: string;
  trailingControls?: React.ReactNode;
  ariaLabel?: string;
}

interface SavedTabScrollPosition {
  containerTop: number;
  windowY: number;
}

export default function ScrollSafeTabs({
  tabs,
  paramKey = 'tab',
  defaultTabId,
  trailingControls,
  ariaLabel = 'Operation views'
}: ScrollSafeTabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const fallbackTabId = defaultTabId || tabs[0]?.id || '';
  const requestedTab = searchParams.get(paramKey);

  const activeTabId = useMemo(() => {
    if (requestedTab && tabs.some(tab => tab.id === requestedTab)) {
      return requestedTab;
    }
    return fallbackTabId;
  }, [requestedTab, tabs, fallbackTabId]);

  const [visitedTabIds, setVisitedTabIds] = useState<string[]>(() =>
    activeTabId ? [activeTabId] : []
  );

  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Record<string, SavedTabScrollPosition>>({});
  const prevActiveTabRef = useRef<string>(activeTabId);

  useEffect(() => {
    if (!activeTabId) return;
    setVisitedTabIds(prev => (prev.includes(activeTabId) ? prev : [...prev, activeTabId]));
  }, [activeTabId]);

  // Continuously capture active tab's scroll offset without re-rendering
  const recordScrollPosition = (tabId: string) => {
    if (!tabId || typeof window === 'undefined') return;
    scrollPositionsRef.current[tabId] = {
      containerTop: scrollContainerRef.current ? scrollContainerRef.current.scrollTop : 0,
      windowY: window.scrollY
    };
  };

  // Restore saved scroll position synchronously after panel visibility switches
  useLayoutEffect(() => {
    if (prevActiveTabRef.current === activeTabId) return;
    prevActiveTabRef.current = activeTabId;

    const saved = scrollPositionsRef.current[activeTabId];
    if (!saved) return;

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = saved.containerTop;
    }
    if (typeof window !== 'undefined' && Math.abs(window.scrollY - saved.windowY) > 1) {
      window.scrollTo({ top: saved.windowY, behavior: 'auto' });
    }
  }, [activeTabId]);

  // Center the active tab horizontally in scrollable mobile/tablet tab strips
  useEffect(() => {
    const activeButton = tabButtonRefs.current[activeTabId];
    if (activeButton && typeof activeButton.scrollIntoView === 'function') {
      const reducedMotion =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      activeButton.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        inline: 'center',
        block: 'nearest'
      });
    }
  }, [activeTabId]);

  const selectTab = (nextTabId: string, focusButton = true) => {
    if (!nextTabId || nextTabId === activeTabId) {
      if (focusButton) {
        tabButtonRefs.current[nextTabId]?.focus({ preventScroll: true });
      }
      return;
    }

    recordScrollPosition(activeTabId);
    setVisitedTabIds(prev => (prev.includes(nextTabId) ? prev : [...prev, nextTabId]));

    setSearchParams(
      prev => {
        const updated = new URLSearchParams(prev);
        updated.set(paramKey, nextTabId);
        return updated;
      },
      { preventScrollReset: true }
    );

    if (focusButton) {
      window.requestAnimationFrame(() => {
        tabButtonRefs.current[nextTabId]?.focus({ preventScroll: true });
      });
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!tabs.length) return;
    let nextIndex = -1;

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex >= 0) {
      event.preventDefault();
      const targetTab = tabs[nextIndex];
      if (targetTab) {
        selectTab(targetTab.id, true);
      }
    }
  };

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-xs">
        <div
          role="tablist"
          aria-label={ariaLabel}
          className="flex flex-row items-center gap-2 overflow-x-auto no-scrollbar py-0.5 flex-1"
        >
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                ref={el => {
                  tabButtonRefs.current[tab.id] = el;
                }}
                id={`scroll-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`scroll-tabpanel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(tab.id, true)}
                onKeyDown={event => handleTabKeyDown(event, index)}
                className={`min-h-11 min-w-11 flex flex-row items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                  isActive
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span
                    className={`text-xs tabular-nums ${
                      isActive ? 'text-blue-100 font-semibold' : 'text-slate-500 font-medium'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {trailingControls && (
          <div className="flex flex-row items-center justify-end gap-2 shrink-0">
            {trailingControls}
          </div>
        )}
      </div>

      {/* Keep-Alive Tab Panels Container with per-tab scroll preservation */}
      <div
        ref={scrollContainerRef}
        onScroll={() => recordScrollPosition(activeTabId)}
        className="flex-1 overflow-y-auto flex flex-col"
      >
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isVisited = visitedTabIds.includes(tab.id);
          if (!isVisited) return null;

          return (
            <div
              key={tab.id}
              id={`scroll-tabpanel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`scroll-tab-${tab.id}`}
              aria-hidden={!isActive}
              className={isActive ? 'flex flex-col flex-1 gap-4' : 'hidden'}
            >
              {tab.renderPanel()}
            </div>
          );
        })}
      </div>
    </section>
  );
}
