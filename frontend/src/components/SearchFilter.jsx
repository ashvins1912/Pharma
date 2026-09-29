import React, { useState } from 'react';
export default function SearchFilter({ onSearchChange }) {
    const [query, setQuery] = useState('');
    const [hideRx, setHideRx] = useState(false);
    const handle = (t, r) => { setQuery(t); setHideRx(r); onSearchChange({ query: t, hideRx: r }); };
    return (
        <div className="bg-white p-4 rounded-2xl border shadow-sm flex flex-col gap-3">
            <input type="text" placeholder="Search medicine formulations..." value={query} onChange={e=>handle(e.target.value, hideRx)} className="w-full px-4 py-2 rounded-xl text-sm border border-slate-200 outline-none"/>
            <label className="text-xs font-medium text-slate-500 flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={hideRx} onChange={e=>handle(query, e.target.checked)}/> Hide Prescription (Rx Only) Drugs
            </label>
        </div>
    );
}
