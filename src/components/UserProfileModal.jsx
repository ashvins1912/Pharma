import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function UserProfileModal({ isOpen, onClose, onNavigate }) {
  const { user, role, isAdmin, logout } = useAuth();
  const { addToast } = useToast();

  if (!isOpen || !user) return null;

  const displayName = user.user_metadata?.name || user.email?.split('@')[0] || "Valued Customer";
  const mobile = user.user_metadata?.mobile || "+91 95899 16475";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-sm w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
        >
          ✕
        </button>

        {/* Avatar & Info */}
        <div className="text-center pt-2 pb-5 border-b border-slate-100">
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

        {/* Menu Options */}
        <div className="py-4 space-y-1 text-xs font-bold text-slate-700">
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
  );
}
