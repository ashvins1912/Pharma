import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';

export default function WhatsAppConnectModal({ isOpen, onClose }) {
  const {
    whatsappStatus,
    generateWhatsAppQR,
    disconnectWhatsApp,
    triggerWhatsAppWarningNotification,
    loadWhatsAppStatus
  } = useApp();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    loadWhatsAppStatus();
    const statusPoll = setInterval(loadWhatsAppStatus, 3000);
    return () => clearInterval(statusPoll);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (!whatsappStatus.isConnected) {
      triggerWhatsAppWarningNotification();
    }
    onClose();
  };

  const handleRefreshQR = async () => {
    try {
      setLoading(true);
      await generateWhatsAppQR();
      addToast('New WhatsApp QR code generated.', 'info');
    } catch {
      addToast('Failed to regenerate QR code.', 'error');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div
        className="fixed inset-0"
        onClick={handleClose}
      />

      <div className="relative w-full max-w-lg bg-white border border-slate-200 rounded-3xl shadow-2xl z-10 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-4 sm:p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-xl">
              📲
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight leading-tight">
                  WhatsApp Dispatch Gateway
                </h3>
                {whatsappStatus.isConnected ? (
                  <span className="bg-emerald-400/30 text-emerald-100 border border-emerald-300/40 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                    ● Connected
                  </span>
                ) : (
                  <span className="bg-rose-500/30 text-rose-100 border border-rose-300/40 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                    ● Disconnected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-emerald-100 font-medium mt-0.5">
                Real-time customer delivery updates, rider tracking & OTP dispatch
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-bold transition cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          
          {whatsappStatus.isConnected ? (
            /* Connected View */
            <div className="space-y-4 text-center py-3">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center text-3xl mx-auto shadow-inner">
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

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left space-y-2 text-xs">
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

              <div className="flex gap-2 justify-center pt-2">
                <button
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer"
                >
                  Disconnect WhatsApp
                </button>
                <button
                  onClick={onClose}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition cursor-pointer shadow-sm"
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
                <span className="text-base flex-shrink-0">⚠️</span>
                <div className="leading-snug">
                  <strong className="font-extrabold block">WhatsApp Dispatch Offline</strong>
                  Please scan the QR code to connect your WhatsApp account. If you close this, you will receive a notification warning regarding missed mobile delivery updates.
                </div>
              </div>

              {/* QR Code & Instructions Container */}
              <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                
                {/* QR Code Box */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="relative w-44 h-44 bg-white border-2 border-emerald-500/30 rounded-2xl p-2 shadow-sm flex items-center justify-center overflow-hidden">
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
                    className="mt-2 text-[11px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <span>🔄</span>
                    <span>Refresh QR Code</span>
                  </button>
                </div>

                {/* Instructions */}
                <div className="space-y-2.5 text-xs text-slate-600 flex-1">
                  <h4 className="font-extrabold text-slate-900 text-xs uppercase tracking-wider">
                    How to Link WhatsApp:
                  </h4>
                  <ol className="space-y-1.5 list-decimal list-inside text-[11px] leading-relaxed text-slate-700">
                    <li>Open <strong>WhatsApp</strong> on your phone</li>
                    <li>Tap <strong>Menu (⋮)</strong> or <strong>Settings (⚙️)</strong></li>
                    <li>Select <strong>Linked Devices</strong></li>
                    <li>Tap <strong>Link a Device</strong> and point your camera here</li>
                  </ol>

                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
                <p className="flex-1 text-[11px] text-slate-500">
                  This QR is generated by WhatsApp and expires quickly. The connection status updates after it is scanned.
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Close (Remind Me Later)
                </button>
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 p-3 border-t border-slate-200 text-center text-[11px] text-slate-400">
          Ashvin Pharmacy Real-Time Order Verification & WhatsApp Dispatch Gateway
        </div>
      </div>
    </div>
  );
}
