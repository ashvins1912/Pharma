import React, { useState } from 'react';

/**
 * Pure Presentation Component: RiderCard
 * Displays individual rider telemetry, active status, and GPS coordinates.
 */
export default function RiderCard({ rider, onStatusChange, onLocationUpdate }) {
    const [updating, setUpdating] = useState(false);

    const handleStatus = async (status) => {
        if (status === rider.status) return;
        setUpdating(true);
        try {
            await onStatusChange(rider.id, status);
        } finally {
            setUpdating(false);
        }
    };

    const handleSimulateMovement = async () => {
        setUpdating(true);
        try {
            const currentLng = rider.currentLocation?.coordinates?.[0] || 77.5946;
            const currentLat = rider.currentLocation?.coordinates?.[1] || 12.9716;
            // Nudge location slightly (~300m)
            const deltaLat = (Math.random() - 0.5) * 0.006;
            const deltaLng = (Math.random() - 0.5) * 0.006;
            await onLocationUpdate(rider.id, currentLng + deltaLng, currentLat + deltaLat);
        } finally {
            setUpdating(false);
        }
    };

    const statusBadgeClass = {
        Available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        Busy: 'bg-amber-50 text-amber-700 border-amber-200',
        'Off-duty': 'bg-slate-100 text-slate-600 border-slate-200'
    }[rider.status] || 'bg-slate-100 text-slate-600 border-slate-200';

    const vehicleIcon = {
        'EV Bike': '⚡',
        Bike: '🏍️',
        Scooter: '🛵',
        Cycle: '🚲',
        Drone: '🛸'
    }[rider.vehicleType] || '🛵';

    const lng = rider.currentLocation?.coordinates?.[0]?.toFixed(4) || '77.5946';
    const lat = rider.currentLocation?.coordinates?.[1]?.toFixed(4) || '12.9716';

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition flex flex-col justify-between gap-3 relative">
            {/* Top row: Avatar & details */}
            <div className="flex items-start gap-3">
                <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0">
                    <img
                        src={rider.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(rider.name)}&background=4F46E5&color=fff`}
                        alt={rider.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(rider.name)}&background=4F46E5&color=fff`;
                        }}
                    />
                    <span className="absolute bottom-0 right-0 text-[10px] bg-white/90 rounded-tl-md px-0.5">
                        {vehicleIcon}
                    </span>
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                        <h4 className="text-sm font-black text-slate-900 truncate">{rider.name}</h4>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${statusBadgeClass}`}>
                            {rider.status}
                        </span>
                    </div>
                    <p className="text-xs text-slate-500 font-medium truncate">{rider.mobile}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 font-semibold">
                        <span>⭐ {rider.rating || 4.9}</span>
                        <span>•</span>
                        <span>{rider.totalDeliveries || 0} deliveries</span>
                    </div>
                </div>
            </div>

            {/* GPS & Active Load */}
            <div className="bg-slate-50 rounded-xl p-2.5 flex items-center justify-between text-[11px] border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-600">
                    <span>📍</span>
                    <span className="font-mono text-[10px]">{lat}, {lng}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-slate-400">Load:</span>
                    <span className={`font-black px-1.5 py-0.2 rounded-md text-[10px] ${
                        (rider.activeOrderIds?.length || 0) > 0
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-slate-200 text-slate-700'
                    }`}>
                        {rider.activeOrderIds?.length || 0} orders
                    </span>
                </div>
            </div>

            {/* Actions: Status toggles & GPS simulate */}
            <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => handleStatus('Available')}
                        disabled={updating || rider.status === 'Available'}
                        className={`text-[10px] font-bold px-2 py-1 rounded-lg transition cursor-pointer ${
                            rider.status === 'Available'
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600'
                        }`}
                        title="Set Available for Dispatch"
                    >
                        Available
                    </button>
                    <button
                        onClick={() => handleStatus('Busy')}
                        disabled={updating || rider.status === 'Busy'}
                        className={`text-[10px] font-bold px-2 py-1 rounded-lg transition cursor-pointer ${
                            rider.status === 'Busy'
                                ? 'bg-amber-500 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-600'
                        }`}
                        title="Set Busy"
                    >
                        Busy
                    </button>
                    <button
                        onClick={() => handleStatus('Off-duty')}
                        disabled={updating || rider.status === 'Off-duty'}
                        className={`text-[10px] font-bold px-2 py-1 rounded-lg transition cursor-pointer ${
                            rider.status === 'Off-duty'
                                ? 'bg-slate-700 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                        title="Set Off-duty"
                    >
                        Off-duty
                    </button>
                </div>

                <button
                    onClick={handleSimulateMovement}
                    disabled={updating}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
                    title="Simulate GPS movement in live zone"
                >
                    <span>🛰️</span>
                    <span>Move</span>
                </button>
            </div>
        </div>
    );
}
