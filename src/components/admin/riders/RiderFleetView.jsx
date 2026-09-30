import React, { useState } from 'react';
import { useRiderManagement } from '../../../hooks/useRiderManagement';
import { useOrderDashboard } from '../../../hooks/useOrderDashboard';
import RiderCard from './RiderCard';
import RiderOnboardingModal from './RiderOnboardingModal';
import AssignmentEngineMonitor from './AssignmentEngineMonitor';

/**
 * Pure Presentation View: RiderFleetView
 * Connects useRiderManagement and useOrderDashboard hooks with UI presentation components.
 */
export default function RiderFleetView() {
    const {
        riders,
        loadingRiders,
        ridersError,
        fetchRiders,
        updateStatus,
        updateLocation,
        engineStatus,
        fetchEngineStatus,
        stats
    } = useRiderManagement();

    const {
        groupedOrders,
        autoAssignOrder,
        manualAssignOrder,
        assignmentExecuting,
        loadOrders
    } = useOrderDashboard();

    const [onboardingOpen, setOnboardingOpen] = useState(false);
    const [activeSubTab, setActiveSubTab] = useState('fleet'); // 'fleet' | 'engine'
    const [searchFilter, setSearchFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const filteredRiders = riders.filter((r) => {
        const matchesSearch = !searchFilter ||
            r.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
            r.mobile.includes(searchFilter);
        const matchesStatus = !statusFilter || r.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    const handleRiderAdded = () => {
        fetchRiders();
        fetchEngineStatus();
    };

    const handleAutoAssign = async (orderId) => {
        const result = await autoAssignOrder(orderId);
        await Promise.all([fetchRiders(), fetchEngineStatus(), loadOrders()]);
        return result;
    };

    const handleManualAssign = async (orderId, riderId) => {
        const result = await manualAssignOrder(orderId, riderId);
        await Promise.all([fetchRiders(), fetchEngineStatus(), loadOrders()]);
        return result;
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Top Sub-tabs & Action bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setActiveSubTab('fleet')}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                            activeSubTab === 'fleet'
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                    >
                        🛵 Active Fleet ({stats.total})
                    </button>
                    <button
                        onClick={() => setActiveSubTab('engine')}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                            activeSubTab === 'engine'
                                ? 'bg-purple-600 text-white shadow-sm'
                                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                    >
                        <span>⚡</span>
                        <span>Auto-Assignment Engine ({groupedOrders.unassigned.length} pending)</span>
                    </button>
                </div>

                <button
                    onClick={() => setOnboardingOpen(true)}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-md shadow-purple-500/20 transition cursor-pointer flex items-center gap-1.5"
                >
                    <span>➕</span>
                    <span>Onboard New Rider</span>
                </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
                    <span className="text-[10px] font-black uppercase text-slate-400">Available Now</span>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black text-emerald-600">{stats.available}</span>
                        <span className="text-[11px] text-slate-400">ready for dispatch</span>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
                    <span className="text-[10px] font-black uppercase text-slate-400">On Active Route</span>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black text-amber-600">{stats.busy}</span>
                        <span className="text-[11px] text-slate-400">busy riders</span>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
                    <span className="text-[10px] font-black uppercase text-slate-400">En Route Orders</span>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black text-purple-600">{stats.totalActiveDeliveries}</span>
                        <span className="text-[11px] text-slate-400">active packages</span>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
                    <span className="text-[10px] font-black uppercase text-slate-400">Off-duty / Resting</span>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-2xl font-black text-slate-700">{stats.offDuty}</span>
                        <span className="text-[11px] text-slate-400">couriers</span>
                    </div>
                </div>
            </div>

            {/* Error banner if any */}
            {ridersError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs">
                    {ridersError}
                </div>
            )}

            {/* SUB-TAB 1: RIDER FLEET CARDS */}
            {activeSubTab === 'fleet' && (
                <div className="space-y-4">
                    {/* Filters */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="relative w-full sm:w-72">
                            <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
                            <input
                                type="text"
                                placeholder="Search rider name or mobile..."
                                value={searchFilter}
                                onChange={(e) => setSearchFilter(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-purple-500 focus:bg-white transition"
                            />
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 outline-none font-bold text-slate-700"
                            >
                                <option value="">All Statuses</option>
                                <option value="Available">🟢 Available Only</option>
                                <option value="Busy">🟡 Busy Only</option>
                                <option value="Off-duty">⚪ Off-duty Only</option>
                            </select>

                            <button
                                onClick={() => fetchRiders()}
                                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl font-bold transition"
                            >
                                Refresh
                            </button>
                        </div>
                    </div>

                    {/* Riders Grid */}
                    {loadingRiders ? (
                        <div className="text-center py-12 text-slate-400 text-xs font-semibold">
                            Loading fleet telemetry...
                        </div>
                    ) : filteredRiders.length === 0 ? (
                        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
                            <p className="text-sm font-bold text-slate-600">No riders match the current filter.</p>
                            <button
                                onClick={() => setOnboardingOpen(true)}
                                className="mt-3 text-xs text-purple-600 font-extrabold hover:underline"
                            >
                                Onboard the first courier rider
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredRiders.map((rider) => (
                                <RiderCard
                                    key={rider.id}
                                    rider={rider}
                                    onStatusChange={updateStatus}
                                    onLocationUpdate={updateLocation}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* SUB-TAB 2: AUTOMATED ASSIGNMENT ENGINE MONITOR */}
            {activeSubTab === 'engine' && (
                <AssignmentEngineMonitor
                    engineStatus={engineStatus}
                    unassignedOrders={groupedOrders.unassigned}
                    riders={riders}
                    onAutoAssign={handleAutoAssign}
                    onManualAssign={handleManualAssign}
                    executing={assignmentExecuting}
                />
            )}

            {/* Rider Onboarding Modal Dialog */}
            <RiderOnboardingModal
                isOpen={onboardingOpen}
                onClose={() => setOnboardingOpen(false)}
                onRiderAdded={handleRiderAdded}
            />
        </div>
    );
}
