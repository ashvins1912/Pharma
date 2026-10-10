import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';

export default function WhatsAppConnectModal({ isOpen, onClose }) {
  const {
    whatsappStatus,
    generateWhatsAppQR,
    disconnectWhatsApp,
    loadWhatsAppStatus,
    dismissWhatsAppPrompt
  } = useApp();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(false);

  // Controlled polling: Check once on open, then slow poll (every 18s) only while waiting for QR scan
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    let pollInterval;

    // Check once immediately on open
    void loadWhatsAppStatus({ force: true });

    // Only slow-poll if not connected
    if (!whatsappStatus.isConnected) {
      pollInterval = setInterval(() => {
        if (!cancelled && !whatsappStatus.isConnected) {
          void loadWhatsAppStatus({ force: false });
        }
      }, 18000);
    }

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isOpen, whatsappStatus.isConnected, loadWhatsAppStatus]);

  if (!isOpen) return null;

  const handleRemindLater = () => {
    dismissWhatsAppPrompt('later');
    addToast('WhatsApp pairing postponed for 24 hours.', 'info');
    onClose();
  };

  const handleNotRequired = () => {
    dismissWhatsAppPrompt('not_required');
    addToast('WhatsApp pairing disabled. You can reconnect anytime from the header button.', 'info');
    onClose();
  };

  const handleRefreshQR = async () => {
    try {
      setLoading(true);
      await generateWhatsAppQR();
      addToast('New WhatsApp QR code generated.', 'info');
    } catch (err) {
      addToast(err?.message || 'Failed to regenerate QR code.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setLoading(true);
      await disconnectWhatsApp();
      addToast('WhatsApp gateway disconnected. Mobile updates paused.', 'warning');
      await generateWhatsAppQR();
    } catch {
      addToast('Failed to disconnect WhatsApp.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 backdrop-blur-[2px] animate-fade-in overscroll-none"
      aria-modal="true"
      role="dialog"
      aria-labelledby="whatsapp-gateway-title"
    >
      {/* Backdrop */}
      <div
        className="modal-backdrop absolute inset-0 touch-none"
        onClick={handleRemindLater}
        onWheel={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
        aria-hidden="true"
      />

      <div className="relative z-10 m-auto flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 text-slate-800 shadow-2xl overscroll-contain">
        {/* Modal Header */}
        <div className="shrink-0 bg-gradient-to-r from-blue-700 to-indigo-800 p-4 sm:p-5 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 shrink-0 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-xl shadow-inner">
              📲
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="whatsapp-gateway-title" className="text-base sm:text-lg font-black tracking-tight leading-tight truncate">
                  WhatsApp Dispatch Gateway
                </h3>
                {whatsappStatus.isConnected ? (
                  <span className="bg-emerald-400/20 text-emerald-200 border border-emerald-300/30 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                    ● Connected
                  </span>
                ) : (
                  <span className="bg-rose-500/30 text-rose-100 border border-rose-300/40 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse shrink-0">
                    ● Disconnected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-blue-100 font-medium mt-0.5 line-clamp-1">
                Real-time customer delivery updates, rider tracking & OTP dispatch
              </p>
            </div>
          </div>

          <button
            onClick={handleRemindLater}
            className="w-8 h-8 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold transition cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto overscroll-contain space-y-4">
          
          {whatsappStatus.isConnected ? (
            /* Connected View */
            <div className="space-y-4 text-center py-2">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-3xl flex items-center justify-center text-3xl mx-auto shadow-inner">
                ✓
              </div>
              <div>
                <h4 className="font-extrabold text-slate-900 text-base">
                  WhatsApp Device is Active & Connected
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  All customer order confirmations, live rider tracking links, and delivery verification OTPs are being dispatched through this channel.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 text-left space-y-2 text-xs shadow-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Linked Phone:</span>
                  <strong className="text-slate-800 font-mono">{whatsappStatus.phone || '+91 98450 12345'}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Device Name:</span>
                  <strong className="text-slate-800">{whatsappStatus.deviceName || 'Admin Primary Mobile'}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Connected At:</span>
                  <span className="text-slate-700 font-medium">
                    {whatsappStatus.lastConnectedAt ? new Date(whatsappStatus.lastConnectedAt).toLocaleTimeString() : 'Active'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2.5 justify-center pt-2">
                <button
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer"
                >
                  Disconnect WhatsApp
                </button>
                <button
                  onClick={onClose}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-6 py-2.5 rounded-xl transition cursor-pointer shadow-sm"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* Disconnected / Pairing View */
            <div className="space-y-4">
              
              {/* Warning Notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-start gap-2.5 text-xs text-amber-800">
                <span className="text-base shrink-0">⚠️</span>
                <div className="leading-snug">
                  <strong className="font-extrabold block">WhatsApp Dispatch Offline</strong>
                  Connect WhatsApp to automate patient order delivery confirmations and rider dispatch tracking. You can postpone or dismiss if not required.
                </div>
              </div>

              {/* QR Code & Step-by-Step Instructions Container */}
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
                
                {/* QR Code Box */}
                <div className="flex flex-col items-center shrink-0 w-48">
                  <div className="relative w-44 h-44 bg-white border-2 border-blue-500/20 rounded-2xl p-2 shadow-sm flex items-center justify-center overflow-hidden">
                    {whatsappStatus.qrCode ? (
                      <img
                        src={whatsappStatus.qrCode}
                        alt="WhatsApp Pairing QR Code"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-center p-3 text-slate-400 text-xs">
                        {loading ? 'Generating QR...' : 'Loading QR...'}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleRefreshQR}
                    disabled={loading}
                    className="mt-2.5 text-[11px] text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <span>🔄</span>
                    <span>{loading ? 'Generating...' : 'Refresh QR Code'}</span>
                  </button>
                </div>

                {/* Instructions with Pristine Numbered Alignment */}
                <div className="flex-1 space-y-3 pt-1 text-xs text-slate-600 min-w-0">
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wider">
                    How to Link WhatsApp:
                  </h4>
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <p className="text-[11px] text-slate-700 leading-snug">
                        Open <strong>WhatsApp</strong> on your pharmacy mobile device
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <p className="text-[11px] text-slate-700 leading-snug">
                        Tap <strong>Menu (⋮)</strong> or <strong>Settings (⚙️)</strong>
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <p className="text-[11px] text-slate-700 leading-snug">
                        Select <strong>Linked Devices</strong>
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                        4
                      </span>
                      <p className="text-[11px] text-slate-700 leading-snug">
                        Tap <strong>Link a Device</strong> and point your camera here
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Remind Me Later & Not Required */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-1">
                <p className="text-[11px] text-slate-500 leading-tight">
                  Status checks are throttled to save resources. Updates automatically once scanned.
                </p>
                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                  <button
                    type="button"
                    onClick={handleNotRequired}
                    className="w-1/2 sm:w-auto px-3 py-2 text-xs font-bold text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                    title="Dismiss permanently until manually re-opened"
                  >
                    Not Required
                  </button>
                  <button
                    type="button"
                    onClick={handleRemindLater}
                    className="w-1/2 sm:w-auto px-4 py-2 text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-200/70 hover:bg-slate-200 rounded-xl transition cursor-pointer"
                  >
                    Remind Later
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="shrink-0 bg-slate-50 p-3 border-t border-slate-200 text-center text-[11px] text-slate-400 font-medium">
          Ashvin Pharmacy Real-Time Order Verification & WhatsApp Dispatch Gateway
        </div>
      </div>
    </div>
  );
}
