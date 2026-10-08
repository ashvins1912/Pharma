import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';

export default function AdminAlertBell({ onOpenAlerts }) {
  const { inventoryAlerts, whatsappStatus, setWhatsappModalOpen } = useApp();
  const [isOpen, setIsOpen] = useState(false);

  const total = (inventoryAlerts.totalAlerts || 0) + (!whatsappStatus.isConnected ? 1 : 0);

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (onOpenAlerts) onOpenAlerts();
        }}
        className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 transition cursor-pointer flex items-center justify-center flex-shrink-0"
        aria-label="Admin Inventory Alerts"
      >
        <span className="text-sm sm:text-base select-none">🔔</span>
        {total > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-600 text-white text-[9px] sm:text-[10px] font-black w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shadow animate-pulse">
            {total}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs sm:bg-transparent"
          />
          <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-96 max-w-md bg-white border border-slate-200 rounded-3xl shadow-2xl z-50 p-4 sm:p-5 space-y-4 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                  Dispensary Alerts ({total})
                </h4>
                <p className="text-[10px] text-slate-400">Automated safety threshold monitor</p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xs font-bold p-1 rounded-full hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-64 sm:max-h-80 overflow-y-auto">
              
              {/* WhatsApp Gateway Status Card */}
              <div className={`p-3 rounded-2xl border transition ${
                whatsappStatus.isConnected
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-amber-50 border-amber-300'
              }`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-black flex items-center gap-1.5 ${
                    whatsappStatus.isConnected ? 'text-emerald-900' : 'text-amber-950'
                  }`}>
                    <span>📲</span> WhatsApp Dispatch Gateway
                  </span>
                  <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase ${
                    whatsappStatus.isConnected ? 'bg-emerald-200 text-emerald-800' : 'bg-rose-200 text-rose-800'
                  }`}>
                    {whatsappStatus.isConnected ? 'Connected' : 'Offline'}
                  </span>
                </div>
                <p className={`text-[11px] mt-1 leading-snug ${
                  whatsappStatus.isConnected ? 'text-emerald-700' : 'text-amber-800'
                }`}>
                  {whatsappStatus.isConnected
                    ? `Linked to ${whatsappStatus.phone || 'Primary Phone'} for real-time mobile order dispatch updates.`
                    : 'You may miss delivery updates on mobile. Automated SMS/WhatsApp notifications are paused.'}
                </p>
                {!whatsappStatus.isConnected && (
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      setWhatsappModalOpen(true);
                    }}
                    className="mt-2 w-full bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-[11px] py-1.5 rounded-xl cursor-pointer shadow-xs transition"
                  >
                    Scan QR to Connect WhatsApp →
                  </button>
                )}
              </div>

              {/* Expired Category */}
              <div className="p-3 bg-red-50 border border-red-200 rounded-2xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-red-900 flex items-center gap-1.5">
                    <span>🔴</span> Expired Medicines ({inventoryAlerts.expiredCount})
                  </span>
                  <span className="text-[10px] bg-red-200 text-red-800 font-extrabold px-1.5 py-0.5 rounded">
                    Blocked
                  </span>
                </div>
                {inventoryAlerts.expired.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No expired pharmaceuticals.</p>
                ) : (
                  <div className="space-y-1">
                    {inventoryAlerts.expired.map(m => (
                      <div key={m._id} className="text-[11px] text-red-700 flex justify-between">
                        <span className="truncate max-w-[170px]">• {m.name}</span>
                        <span className="font-bold">Expired {Math.abs(m.daysLeft)}d ago</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Expiring ≤ 30 Days */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                    <span>🟠</span> Expiring in ≤30 days ({inventoryAlerts.expiringSoonCount})
                  </span>
                  <span className="text-[10px] bg-amber-200 text-amber-900 font-extrabold px-1.5 py-0.5 rounded">
                    Urgent
                  </span>
                </div>
                {inventoryAlerts.expiringSoon.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No medicines near expiry.</p>
                ) : (
                  <div className="space-y-1">
                    {inventoryAlerts.expiringSoon.map(m => (
                      <div key={m._id} className="text-[11px] text-amber-800 flex justify-between">
                        <span className="truncate max-w-[170px]">• {m.name}</span>
                        <span className="font-bold">{m.daysLeft}d left</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Low Stock (≤ 3) */}
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-2xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-yellow-900 flex items-center gap-1.5">
                    <span>🟡</span> Low Stock ({inventoryAlerts.lowStockCount})
                  </span>
                  <span className="text-[10px] bg-yellow-200 text-yellow-900 font-extrabold px-1.5 py-0.5 rounded">
                    Restock
                  </span>
                </div>
                {inventoryAlerts.lowStock.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Adequate inventory levels.</p>
                ) : (
                  <div className="space-y-1">
                    {inventoryAlerts.lowStock.map(m => (
                      <div key={m._id} className="text-[11px] text-yellow-800 flex justify-between">
                        <span className="truncate max-w-[170px]">• {m.name}</span>
                        <span className="font-bold">{m.stock} left</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 text-center">
              <span className="text-[10px] text-slate-400">
                Dispensary Safety Controls Active
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
