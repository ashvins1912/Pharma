import React from 'react';

export default function FulfillmentTabs({
    viewMode,
    setViewMode,
    activeTabId,
    setActiveTabId,
    layoutDirection,
    setLayoutDirection,
    columns,
    counts
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 p-3.5 rounded-2xl shadow-sm">
            <div className="flex items-center gap-1.5 flex-wrap">
                <button
                    type="button"
                    onClick={() => setViewMode('tabbed')}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                        viewMode === 'tabbed'
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                >
                    <span>📋</span>
                    <span>Tabbed Stage View</span>
                </button>
                <button
                    type="button"
                    onClick={() => setViewMode('all')}
                    className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                        viewMode === 'all'
                            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                >
                    <span>🗂️</span>
                    <span>All Columns Grid</span>
                </button>
            </div>

            {viewMode === 'tabbed' ? (
                <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full">
                    {columns.map((col) => {
                        const count = counts[col.id] || 0;
                        const isSelected = activeTabId === col.id;
                        return (
                            <button
                                key={col.id}
                                type="button"
                                onClick={() => setActiveTabId(col.id)}
                                className={`px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap transition cursor-pointer flex items-center gap-2 ${
                                    isSelected
                                        ? 'bg-slate-900 text-white shadow-md'
                                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <span>{col.title}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${isSelected ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-slate-500">Layout Mode:</span>
                    <button
                        type="button"
                        onClick={() => setLayoutDirection(layoutDirection === 'vertical' ? 'horizontal' : 'vertical')}
                        className="px-4 py-2 rounded-xl text-xs font-extrabold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer flex items-center gap-1.5 shadow-sm"
                    >
                        <span>{layoutDirection === 'vertical' ? '📐' : '↔️'}</span>
                        <span>{layoutDirection === 'vertical' ? 'Grid View (2x4)' : 'Horizontal Scroll Track'}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
