import React, { useState } from 'react';

/**
 * Pure Presentation Component: AssignmentEngineMonitor
 * Visualizes the expandable strategy pipeline, manual overrides, and real-time execution logs.
 */
export default function AssignmentEngineMonitor({
    engineStatus,
    unassignedOrders = [],
    riders = [],
    onAutoAssign,
    onManualAssign,
    executing = false
}) {
    const [selectedOrderId, setSelectedOrderId] = useState(null);
    const [selectedRiderId, setSelectedRiderId] = useState('');
    const [actionMessage, setActionMessage] = useState(null);

    const handleRunAuto = async (orderId) => {
        setActionMessage(null);
        try {
            const res = await onAutoAssign(orderId);
            setActionMessage({
                type: res.success ? 'success' : 'warning',
                text: res.message || res.reason
            });
        } catch (err) {
            setActionMessage({ type: 'error', text: err.message });
        }
    };

    const handleRunManual = async (orderId) => {
        if (!selectedRiderId) return;
        setActionMessage(null);
        try {
            const res = await onManualAssign(orderId, selectedRiderId);
            setActionMessage({
                type: 'success',
                text: res.message || 'Order assigned manually.'
            });
            setSelectedOrderId(null);
            setSelectedRiderId('');
        } catch (err) {
            setActionMessage({ type: 'error', text: err.message });
        }
    };

    return (
        <div className="space-y-6">
            {/* Action Feedback Banner */}
            {actionMessage && (
                <div
                    className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between border ${
                        actionMessage.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : actionMessage.type === 'warning'
                            ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                >
                    <span>{actionMessage.text}</span>
                    <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-600">
                        ✕
                    </button>
                </div>
            )}

            {/* Pipeline Strategy Chain Overview */}
            <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">⚙️</span>
                        <div>
                            <h4 className="text-sm font-black tracking-tight">Active Assignment Pipeline</h4>
                            <p className="text-[11px] text-slate-400">
                                Expandable Chain of Responsibility (Open/Closed Principle)
                            </p>
                        </div>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2.5 py-1 rounded-full">
                        {engineStatus.pipeline?.length || 2} Strategies Active
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-indigo-300 flex items-center justify-center text-[10px] font-mono">
                                    1
                                </span>
                                OrderClubbingStrategy
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">priority: 10</span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                            Evaluates if expected dispatch is &lt; 15 mins. Checks for existing riders delivering within a 2 km micro-zone and clubs orders.
                        </p>
                    </div>

                    <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                                <span className="w-5 h-5 rounded-full bg-emerald-500/30 text-emerald-300 flex items-center justify-center text-[10px] font-mono">
                                    2
                                </span>
                                ClosestRiderStrategy
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">priority: 20</span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                            Fallback Proximity Strategy: Scans 20 km GeoJSON radius for nearest &apos;Available&apos; rider and flips their status to &apos;Busy&apos;.
                        </p>
                    </div>
                </div>
            </div>

            {/* Unassigned Orders Queue Ready for Assignment */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Unassigned Orders Awaiting Courier</h4>
                        <p className="text-xs text-slate-500">
                            {unassignedOrders.length} order{unassignedOrders.length === 1 ? '' : 's'} ready for automated or manual dispatch
                        </p>
                    </div>
                </div>

                {unassignedOrders.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                        <span className="text-3xl block mb-1">🎉</span>
                        <p className="text-xs font-bold text-slate-600">All dispensary orders currently have couriers assigned!</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">New orders placed by customers will appear here automatically.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {unassignedOrders.map((order) => {
                            const shortId = order.id ? order.id.slice(-6).toUpperCase() : 'UNKNOWN';
                            const isSelected = selectedOrderId === order.id;

                            return (
                                <div key={order.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs font-black text-slate-900">#{shortId}</span>
                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                                {order.orderStatus}
                                            </span>
                                            <span className="text-xs font-extrabold text-slate-700">₹{order.finalTotal}</span>
                                        </div>
                                        <p className="text-xs text-slate-600 font-medium truncate">
                                            👤 {order.customerName} • 📍 {order.deliveryAddress}
                                        </p>
                                    </div>

                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                                        {isSelected ? (
                                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                                                <select
                                                    value={selectedRiderId}
                                                    onChange={(e) => setSelectedRiderId(e.target.value)}
                                                    className="min-w-0 flex-1 text-xs bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 outline-none font-medium"
                                                >
                                                    <option value="">Select Rider...</option>
                                                    {riders.filter(r => !r.isOffDuty?.()).map((r) => (
                                                        <option key={r.id} value={r.id}>
                                                            {r.name} ({r.status})
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => handleRunManual(order.id)}
                                                    disabled={!selectedRiderId || executing}
                                                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold text-xs px-3 py-1.5 rounded-xl transition"
                                                >
                                                    Confirm
                                                </button>
                                                <button
                                                    onClick={() => setSelectedOrderId(null)}
                                                    className="text-slate-400 hover:text-slate-600 text-xs px-2"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => handleRunAuto(order.id)}
                                                    disabled={executing}
                                                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-xs font-black px-3.5 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <span>⚡</span>
                                                    <span>Auto-Assign</span>
                                                </button>
                                                <button
                                                    onClick={() => setSelectedOrderId(order.id)}
                                                    disabled={executing}
                                                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 py-2 rounded-xl transition cursor-pointer"
                                                >
                                                    Manual
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Real-time Strategy Evaluation Logs */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-black text-slate-900">Assignment Engine Telemetry</h4>
                        <p className="text-xs text-slate-500">Live decision audit trail showing strategy decisions</p>
                    </div>
                </div>

                {(!engineStatus.logs || engineStatus.logs.length === 0) ? (
                    <p className="text-xs text-slate-400 italic py-4 text-center">No engine assignment evaluations recorded yet.</p>
                ) : (
                    <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                        {engineStatus.logs.map((log) => (
                            <div key={log.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 text-xs">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${log.status === 'ASSIGNED' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                        <span className="font-mono font-bold text-slate-800">
                                            Order #{log.orderId?.slice(-6).toUpperCase()}
                                        </span>
                                        <span className="text-[10px] text-slate-400">({log.customerName})</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-[10px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full font-bold">
                                            {log.strategyUsed}
                                        </span>
                                        <span className="text-[10px] text-slate-400 font-mono">{log.totalDurationMs}ms</span>
                                    </div>
                                </div>

                                <p className="text-[11px] text-slate-600 font-medium">{log.reason}</p>

                                {log.assignedRider && (
                                    <div className="flex items-center gap-3 text-[10px] text-slate-500 font-semibold pt-1 border-t border-slate-200/60">
                                        <span>🛵 Rider: <strong className="text-slate-700">{log.assignedRider.name}</strong></span>
                                        <span>📞 {log.assignedRider.mobile}</span>
                                        {log.distanceInKm !== null && <span>📏 {log.distanceInKm} km away</span>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
