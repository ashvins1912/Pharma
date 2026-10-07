import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function NotificationBell({ onOpenOrders, onRequireAuth }) {
  const { notifications, unreadNotificationsCount, markNotificationRead, setWhatsappModalOpen } = useApp();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => {
          if (onRequireAuth && !onOpenOrders) {
            onRequireAuth();
            return;
          }
          setIsOpen(!isOpen);
        }}
        className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 transition cursor-pointer flex items-center justify-center flex-shrink-0"
        aria-label="Customer Notifications"
      >
        <span className="text-sm sm:text-base select-none">🔔</span>
        {unreadNotificationsCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-[9px] sm:text-[10px] font-black w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shadow">
            {unreadNotificationsCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs sm:bg-transparent"
          />
          <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-96 max-w-md bg-white border border-slate-200 rounded-3xl shadow-2xl z-50 p-4 space-y-3 animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2.5">
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <span>🔔</span> Notifications ({notifications.length})
              </h4>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xs font-bold p-1 rounded-full hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-64 sm:max-h-72 overflow-y-auto">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => {
                    markNotificationRead(n.id);
                    setIsOpen(false);
                    if (n.actionType === 'CONNECT_WHATSAPP') {
                      setWhatsappModalOpen(true);
                    } else if (onOpenOrders) {
                      onOpenOrders();
                    }
                  }}
                  className={`p-3 rounded-2xl border text-xs cursor-pointer transition ${
                    n.type === 'warning'
                      ? 'border-amber-300 bg-amber-50/80 hover:bg-amber-100/70 font-semibold'
                      : n.read
                      ? 'border-slate-100 bg-white hover:bg-slate-50'
                      : 'border-blue-200 bg-blue-50/60 font-semibold'
                  }`}
                >
                  <div className="flex justify-between items-start gap-1">
                    <p className={`font-bold text-xs ${n.type === 'warning' ? 'text-amber-950' : 'text-slate-900'}`}>
                      {n.title}
                    </p>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{n.time}</span>
                  </div>
                  <p className={`text-[11px] mt-1 leading-snug ${n.type === 'warning' ? 'text-amber-800' : 'text-slate-600'}`}>
                    {n.message}
                  </p>
                  {n.actionType === 'CONNECT_WHATSAPP' && (
                    <div className="mt-2 pt-1 border-t border-amber-200/60 flex items-center justify-between">
                      <span className="text-[10px] font-black text-amber-700 uppercase">Action Required</span>
                      <span className="text-[11px] font-extrabold text-blue-700 underline">
                        Link WhatsApp Device Now →
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 text-center">
              <button
                onClick={() => {
                  setIsOpen(false);
                  if (onOpenOrders) onOpenOrders();
                }}
                className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
              >
                View All Orders & Deliveries →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
