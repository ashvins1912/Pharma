import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import MFAEnrollmentModal from './auth/MFAEnrollmentModal';

export default function UserProfileModal({ isOpen, onClose, onNavigate }) {
  const { user, role, isAdmin, mfaEnabled, aal, disableMfa, logout } = useAuth();
  const { addToast } = useToast();
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [disablingMfa, setDisablingMfa] = useState(false);

  if (!isOpen || !user) return null;

  const displayName = user.user_metadata?.name || user.name || user.email?.split('@')[0] || "Valued Customer";
  const mobile = user.user_metadata?.mobile || user.mobile || "+91 95899 16475";

  const handleDisableMfa = async () => {
    setDisablingMfa(true);
    try {
      await disableMfa();
      addToast('Two-factor authentication has been disabled.', 'info');
    } catch (err) {
      addToast(err.message || 'Could not disable 2FA.', 'error');
    } finally {
      setDisablingMfa(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
        <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-sm w-full p-5 sm:p-6 relative max-h-[90vh] overflow-y-auto">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
          >
            ✕
          </button>

          {/* Avatar & Info */}
          <div className="text-center pt-2 pb-4 border-b border-slate-100">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-2xl uppercase shadow-lg shadow-blue-500/20 mb-3">
              {displayName.charAt(0)}
            </div>
            <h3 className="font-black text-slate-900 text-base">{displayName}</h3>
            <p className="text-xs text-slate-500 font-medium">{user.email}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {role}
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-[11px] text-slate-500 font-semibold">{mobile}</span>
            </div>
          </div>

          {/* Security & Multi-Factor Authentication Card */}
          <div className="my-3.5 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🛡️</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Two-Factor Authentication</h4>
                  <p className="text-[10px] text-slate-400">Zero-cost TOTP with mobile authenticator</p>
                </div>
              </div>
              <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                mfaEnabled
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {mfaEnabled ? 'Active 🟢' : 'Off ⚪'}
              </span>
            </div>

            {mfaEnabled ? (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-emerald-700 font-bold">Assurance Level: {aal.toUpperCase()}</span>
                <button
                  onClick={handleDisableMfa}
                  disabled={disablingMfa}
                  className="text-[10px] font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                >
                  {disablingMfa ? 'Disabling...' : 'Disable 2FA'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEnrollModalOpen(true)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black py-1.5 px-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
              >
                <span>📲</span>
                <span>Enable 2FA (Scan QR Code)</span>
              </button>
            )}
          </div>

          {/* Navigation Options */}
          <div className="py-2 space-y-1 text-xs font-bold text-slate-700">
            <button
              onClick={() => { onClose(); onNavigate('store'); }}
              className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between cursor-pointer transition"
            >
              <span>💊 Browse Medicine Catalog</span>
              <span className="text-slate-400">→</span>
            </button>
            <button
              onClick={() => { onClose(); onNavigate('orders'); }}
              className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between cursor-pointer transition"
            >
              <span>📦 My Orders & Tracking</span>
              <span className="text-slate-400">→</span>
            </button>
            <button
              onClick={() => { onClose(); onNavigate('requests'); }}
              className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between cursor-pointer transition"
            >
              <span>📋 My Medicine Requests</span>
              <span className="text-slate-400">→</span>
            </button>
            <button
              onClick={() => { onClose(); onNavigate('addresses'); }}
              className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-slate-50 flex items-center justify-between cursor-pointer transition"
            >
              <span>🏠 Saved Delivery Addresses</span>
              <span className="text-slate-400">→</span>
            </button>
            {isAdmin && (
              <button
                onClick={() => { onClose(); onNavigate('admin'); }}
                className="w-full text-left px-3.5 py-2.5 rounded-xl bg-purple-50 text-purple-800 hover:bg-purple-100 flex items-center justify-between cursor-pointer transition"
              >
                <span>⚙️ Admin Operations Dashboard</span>
                <span>→</span>
              </button>
            )}
          </div>

          {/* Logout */}
          <div className="pt-3 border-t border-slate-100">
            <button
              onClick={() => {
                logout();
                addToast('Signed out successfully', 'info');
                onClose();
              }}
              className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold py-2.5 rounded-xl text-xs transition cursor-pointer"
            >
              🚪 Sign Out of Account
            </button>
          </div>

        </div>
      </div>

      {/* Zero-Cost TOTP MFA Enrollment Modal */}
      <MFAEnrollmentModal
        isOpen={enrollModalOpen}
        onClose={() => setEnrollModalOpen(false)}
      />
    </>
  );
}
