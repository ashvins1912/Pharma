import React, { useState, useEffect } from 'react';
import apiClient from '../api/apiClient';
import AdminLogistics from './AdminLogistics';

export default function AdminDashboard() {
    const [orders, setOrders] = useState([]);
    const [file, setFile] = useState(null);
    const [code, setCode] = useState('');
    const [pct, setPct] = useState('');
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadOrders();
    }, []);

    const loadOrders = async () => {
        try {
            setLoading(true);
            const res = await apiClient.get('/api/orders/admin/all');
            setOrders(res.data || []);
        } catch {
            // error
        } finally {
            setLoading(false);
        }
    };

    const uploadExcel = async (e) => {
        e.preventDefault();
        if (!file) return;
        const form = new FormData();
        form.append('excelFile', file);
        try {
            await apiClient.post('/api/medicines/upload-excel', form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setStatus('✅ Catalog sync complete!');
            setFile(null);
        } catch (err) {
            setStatus('❌ Excel upload failed: ' + (err.message || 'Error'));
        }
    };

    const makeCoupon = async (e) => {
        e.preventDefault();
        try {
            await apiClient.post('/api/coupons', { code, discountPercentage: Number(pct) });
            setStatus(`🎟️ Voucher ${code.toUpperCase()} Active!`);
            setCode('');
            setPct('');
        } catch (err) {
            setStatus('❌ Coupon creation failed.');
        }
    };

    const seedMedicines = async () => {
        try {
            setStatus('Seeding catalog data...');
            const res = await apiClient.post('/api/test/seed-medicines');
            setStatus(res.data.message || '✅ Demo medicines catalog refreshed!');
        } catch (err) {
            setStatus('❌ Failed to seed catalog.');
        }
    };

    return (
        <div className="space-y-4">
            <AdminLogistics refresh={loadOrders} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white border border-slate-200 p-4 rounded-2xl shadow-sm">
                <form onSubmit={uploadExcel} className="space-y-2 border-b md:border-b-0 md:border-r border-slate-200 pb-4 md:pb-0 md:pr-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">📊 Sync Stock Excel</h4>
                    <input
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={e => setFile(e.target.files?.[0] || null)}
                        className="text-xs file:bg-blue-50 file:text-blue-600 file:border-0 file:rounded-xl file:px-3 file:py-1 cursor-pointer w-full"
                    />
                    <button type="submit" disabled={!file} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold text-xs py-2 rounded-xl cursor-pointer transition">
                        Upload Sheet
                    </button>
                </form>

                <form onSubmit={makeCoupon} className="space-y-2 border-b md:border-b-0 md:border-r border-slate-200 pb-4 md:pb-0 md:pr-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">🎟️ Create Coupon</h4>
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            type="text"
                            placeholder="CODE"
                            value={code}
                            onChange={e => setCode(e.target.value)}
                            className="border border-slate-200 px-2 py-1 text-xs rounded-xl uppercase outline-none focus:border-blue-500"
                            required
                        />
                        <input
                            type="number"
                            placeholder="% Discount"
                            value={pct}
                            onChange={e => setPct(e.target.value)}
                            className="border border-slate-200 px-2 py-1 text-xs rounded-xl outline-none focus:border-blue-500"
                            min="1"
                            max="100"
                            required
                        />
                    </div>
                    <button type="submit" className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs py-2 rounded-xl cursor-pointer transition">
                        Launch Coupon
                    </button>
                </form>

                <div className="space-y-2 flex flex-col justify-between">
                    <div>
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">⚡ Quick Catalog Maintenance</h4>
                        <p className="text-[11px] text-slate-400 mt-1">Reset catalog with standard pharmaceuticals, stock counts, and expiration dates.</p>
                    </div>
                    <button
                        type="button"
                        onClick={seedMedicines}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 rounded-xl cursor-pointer transition shadow-sm"
                    >
                        Seed Demo Medicines
                    </button>
                </div>
            </div>

            {status && (
                <div className="p-2.5 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-bold rounded-xl text-center">
                    {status}
                </div>
            )}

            <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm space-y-3">
                <div className="flex justify-between items-center">
                    <h3 className="font-bold text-sm text-slate-800">📦 Order Fulfillment & Dispatch Pipeline</h3>
                    <button
                        onClick={loadOrders}
                        disabled={loading}
                        className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-lg font-bold text-slate-600 cursor-pointer"
                    >
                        {loading ? 'Refreshing...' : '🔄 Refresh Orders'}
                    </button>
                </div>

                {orders.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">No orders currently in the pipeline.</p>
                ) : (
                    <div className="space-y-2">
                        {orders.map(o => {
                            const orderId = (o._id || '').slice(-6);
                            return (
                                <div key={o._id} className="border border-slate-100 p-3 bg-slate-50/80 rounded-xl flex flex-wrap justify-between items-center gap-2 text-xs">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-900">ID: #{orderId}</span>
                                            <span className="font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-[10px]">
                                                {o.orderStatus}
                                            </span>
                                            {o.deliveryPersonMobile && (
                                                <span className="text-[10px] text-slate-500 font-medium">
                                                    Rider: {o.deliveryPersonMobile}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-slate-500 text-[11px]">
                                            Bill: <strong className="text-emerald-600">₹{o.finalTotal}</strong> | Dest: {(o.deliveryAddress || '').slice(0, 35)}...
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {o.orderStatus === 'Processing Order' && (
                                            <button
                                                onClick={async () => {
                                                    await apiClient.patch(`/api/orders/admin/${o._id}/ready`);
                                                    loadOrders();
                                                }}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 font-bold rounded-lg cursor-pointer transition text-xs shadow-sm"
                                            >
                                                Verify & Pack
                                            </button>
                                        )}
                                        {o.orderStatus === 'Ready to Dispatch' && (
                                            <span className="text-indigo-600 bg-indigo-50 px-2 py-1 rounded text-[11px] font-bold">
                                                Awaiting Courier Assignment
                                            </span>
                                        )}
                                        {o.orderStatus === 'Dispatched' && (
                                            <button
                                                onClick={async () => {
                                                    await apiClient.patch(`/api/orders/admin/${o._id}/deliver`);
                                                    loadOrders();
                                                }}
                                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 font-bold rounded-lg cursor-pointer transition text-xs shadow-sm"
                                            >
                                                Confirm Delivered
                                            </button>
                                        )}
                                        {o.orderStatus === 'Delivered' && (
                                            <span className="text-emerald-700 bg-emerald-50 px-2 py-1 rounded text-[11px] font-bold">
                                                ✅ Completed
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
