import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import MFAEnrollmentModal from './auth/MFAEnrollmentModal';

export default function UserProfileModal({ isOpen, onClose, onNavigate }) {
  const { user, role, isAdmin, mfaEnabled, aal, disableMfa, logout, updateProfile } = useAuth();
  const { addToast } = useToast();
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [disablingMfa, setDisablingMfa] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', gender: '', mobileNumber: '', dateOfBirth: '' });

  useEffect(() => {
    if (!user) return;
    const parts = String(user.name || user.user_metadata?.name || '').trim().split(/\s+/);
    setProfileForm({
      firstName: user.firstName || parts[0] || '',
      lastName: user.lastName || parts.slice(1).join(' ') || '',
      gender: user.gender || '',
      mobileNumber: user.mobileNumber || user.mobile || user.user_metadata?.mobile || '',
      dateOfBirth: user.dateOfBirth || ''
    });
  }, [user, isOpen]);

  const emailVerified = Boolean(user.emailVerified);
  const mobileVerified = Boolean(user.mobileVerified);

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await updateProfile(profileForm);
      addToast('Profile details updated successfully.', 'success');
      setEditMode(false);
    } catch (err) {
      addToast(err.message || 'Could not update profile.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  if (!isOpen || !user) return null;

  const displayName = user.user_metadata?.name || user.name || user.email?.split('@')[0] || "Valued Customer";
  const mobile = user.user_metadata?.mobile || user.mobile || user.mobileNumber || 'Mobile not added';

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

  const handleSignOut = async () => {
    setSigningOut(true);
    await logout();
    addToast('Signed out successfully', 'info');
    onClose();
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


          <div className="my-3.5 p-3.5 bg-white border border-slate-200 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-xs font-black text-slate-800">Personal Details</h4>
                <p className="text-[10px] text-slate-400">Keep your delivery and account details up to date.</p>
              </div>
              {!editMode && (
                <button onClick={() => setEditMode(true)} className="text-[11px] font-black text-blue-600 hover:text-blue-800 cursor-pointer">✎ Edit</button>
              )}
            </div>
            {!editMode ? (
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between"><span className="text-slate-400">Name</span><span className="font-bold text-slate-800">{displayName}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-400">Gender</span><span className="font-bold text-slate-800">{user.gender || 'Not set'}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="text-slate-400">Mobile</span><span className="flex items-center gap-2 font-bold text-slate-800">{mobile{'}'} {mobileVerified ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700" title="Verified">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">✓</span> Verified
                </span> : <span className="text-[10px] text-amber-600 font-bold">Not verified</span>}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="text-slate-400">Email</span><span className="flex items-center gap-2 font-bold text-slate-800">{user.email} {emailVerified ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700" title="Verified">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">✓</span> Verified
                </span> : <span className="text-[10px] text-amber-600 font-bold">Not verified</span>}</span></div>
              </div>
            ) : (
              <form onSubmit={handleSaveProfile} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input value={profileForm.firstName} onChange={e => setProfileForm(p => ({...p, firstName:e.target.value}))} placeholder="First name" required className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-100" />
                  <input value={profileForm.lastName} onChange={e => setProfileForm(p => ({...p, lastName:e.target.value}))} placeholder="Last name" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-100" />
                </div>
                <select value={profileForm.gender} onChange={e => setProfileForm(p => ({...p, gender:e.target.value}))} required className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white">
                  <option value="">Select gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
                <input type="date" value={profileForm.dateOfBirth} onChange={e => setProfileForm(p => ({...p, dateOfBirth:e.target.value}))} required className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs" />
                <div>
                  <div className="flex items-center gap-2">
                    <input value={profileForm.mobileNumber} onChange={e => setProfileForm(p => ({...p, mobileNumber:e.target.value}))} required className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs" placeholder="+91 9876543210" />
                    {mobileVerified && <span title="Verified" className="text-emerald-600 font-black">✓</span>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Changing your mobile requires verification before it can become verified.</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setEditMode(false)} className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer">Cancel</button>
                  <button type="submit" disabled={savingProfile} className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-xs font-black disabled:opacity-60 cursor-pointer">
                    {savingProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}
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
              onClick={handleSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
              className="w-full bg-rose-50 hover:bg-rose-100 disabled:opacity-60 text-rose-700 font-extrabold py-2.5 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-2"
            >
              {signingOut ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                  <span>Signing out...</span>
                </>
              ) : '🚪 Sign Out of Account'}
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
