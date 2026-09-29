import React, { useState } from 'react';
import apiClient from '../api/apiClient';

export default function AdminLogistics({ refresh }) {
    const [mobile, setMobile] = useState('');
    const [rad, setRad] = useState('5');
    const [status, setStatus] = useState('');

    const optimizeRoute = async (e) => {
        e.preventDefault();
        setStatus('Running distance clustering optimization script...');
        try {
            const res = await apiClient.post('/api/orders/admin/optimize-and-club-routes', { deliveryPersonMobile: mobile, maxRadiusKm: Number(rad) });
            setStatus(`✅ ${res.data.message}`); setMobile(''); refresh();
        } catch { setStatus('❌ Routing optimization failure.'); }
    };

    return (
        <form onSubmit={optimizeRoute} className="bg-white border p-4 rounded-2xl shadow-sm flex flex-col sm:flex-row gap-3 items-end mb-4">
            <div className="flex-1 w-full"><label className="text-[10px] font-bold text-slate-400 block mb-1">Rider WhatsApp Number</label><input type="tel" value={mobile} onChange={e=>setMobile(e.target.value)} placeholder="e.g. 919589916475" className="border px-3 py-1.5 text-xs rounded-xl w-full outline-none" required/></div>
            <div className="w-20"><label className="text-[10px] font-bold text-slate-400 block mb-1">Radius (KM)</label><input type="number" value={rad} onChange={e=>setRad(e.target.value)} className="border px-3 py-1.5 text-xs rounded-xl w-full outline-none" required/></div>
            <button type="submit" className="bg-slate-800 text-white px-4 py-2 font-bold text-xs rounded-xl cursor-pointer w-full sm:w-auto shadow-md">Club & Optimize Corridors</button>
            {status && <p className="text-[10px] font-bold text-blue-600 block mt-1 w-full">{status}</p>}
        </form>
    );
}