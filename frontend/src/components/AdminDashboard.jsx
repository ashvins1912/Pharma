import React, { useState, useEffect } from 'react';
import apiClient from '../api/apiClient';
import AdminLogistics from './AdminLogistics';

export default function AdminDashboard() {
    const [orders, setOrders] = useState([]);
    const [file, setFile] = useState(null);
    const [code, setCode] = useState('');
    const [pct, setPct] = useState('');
    const [status, setStatus] = useState('');

    useEffect(() => { loadOrders(); }, []);

    const loadOrders = async () => {
        const res = await apiClient.get('/api/orders/admin/all');
        setOrders(res.data);
    };

    const uploadExcel = async (e) => {
        e.preventDefault(); if (!file) return;
        const form = new FormData(); form.append('excelFile', file);
        await apiClient.post('/api/medicines/upload-excel', form, { headers: { 'Content-Type': 'multipart/form-data' } });
        setStatus('✅ Catalog sync complete!'); setFile(null);
    };

    const makeCoupon = async (e) => {
        e.preventDefault();
        await apiClient.post('/api/coupons', { code, discountPercentage: pct });
        setStatus(`🎟️ Voucher ${code.toUpperCase()} Active!`); setCode(''); setPct('');
    };

    return (
        <div className="space-y-4">
            <AdminLogistics refresh={loadOrders} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white border p-4 rounded-2xl shadow-sm">
                <form onSubmit={uploadExcel} className="space-y-2 border-b sm:border-b-0 sm:border-r pb-4 sm:pb-0 sm:pr-4"><h4 className="text-xs font-bold text-slate-400 uppercase">📊 Sync Stock Excel</h4><input type="file" accept=".xlsx" onChange={e=>setFile(e.target.files)} className="text-xs file:bg-blue-50 file:text-blue-600 file:border-0 file:rounded-xl file:px-3 file:py-1 cursor-pointer"/><button type="submit" className="w-full bg-blue-600 text-white font-bold text-xs py-2 rounded-xl cursor-pointer">Upload Sheet</button></form>
                <form onSubmit={makeCoupon} className="space-y-2"><h4 className="text-xs font-bold text-slate-400 uppercase">🎟️ Create Coupon</h4><div className="grid grid-cols-2 gap-2"><input type="text" placeholder="CODE" value={code} onChange={e=>setCode(e.target.value)} className="border px-2 py-1 text-xs rounded-xl uppercase" required/><input type="number" placeholder="%" value={pct} onChange={e=>setPct(e.target.value)} className="border px-2 py-1 text-xs rounded-xl" required/></div><button type="submit" className="w-full bg-slate-800 text-white font-bold text-xs py-2 rounded-xl cursor-pointer">Launch Coupon</button></form>
            </div>
            {status && <p className="text-[10px] font-black text-blue-600 text-center">{status}</p>}
            <div className="bg-white border p-4 rounded-2xl shadow-sm space-y-3">
                <h3 className="font-bold text-sm text-slate-800">📦 Order Processing Pipeline</h3>
                {orders.map(o => (
                    <div key={o._id} className="border p-3 bg-slate-50 rounded-xl flex justify-between items-center text-xs">
                        <div><p className="font-bold">ID: #{o._id.slice(-6)} — <span className="text-blue-600 font-extrabold">{o.orderStatus}</span></p><p className="text-slate-400">Bill: ₹{o.finalTotal} | Dest: {o.deliveryAddress.slice(0,30)}...</p></div>
                        {o.orderStatus === 'Processing Order' && <button onClick={async ()=>{ await apiClient.patch(`/api/orders/admin/${o._id}/ready`); loadOrders(); }} className="bg-indigo-600 text-white px-3 py-1.5 font-bold rounded-lg cursor-pointer">Verify & Pack</button>}
                        {o.orderStatus === 'Dispatched' && <button onClick={async ()=>{ await apiClient.patch(`/api/orders/admin/${o._id}/deliver`); loadOrders(); }} className="bg-emerald-600 text-white px-3 py-1.5 font-bold rounded-lg cursor-pointer">Confirm Delivered</button>}
                    </div>
                ))}
            </div>
        </div>
    );
}