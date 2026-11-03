import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import MFAEnrollmentModal from './auth/MFAEnrollmentModal';
import RelativeProfiles from './RelativeProfiles';
import { useActionLoading, LOADING_ACTIONS } from '../context/LoadingContext';
import { useLanguage } from '../context/LanguageContext';

const TabButton = ({ active, children, onClick }) => (
  <button type="button" onClick={onClick} className={`flex-1 rounded-xl px-3 py-2 text-[11px] font-black transition ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
    {children}
  </button>
);

export default function UserProfileModal({ isOpen, onClose, onNavigate }) {
  const { t } = useLanguage();
  const { user, role, isSuperAdmin, canAccessOperations, mfaEnabled, aal, disableMfa, logout, updateProfile } = useAuth();
  const { addToast } = useToast();
  const { runAction, isActionLoading } = useActionLoading();
  const [tab, setTab] = useState('overview');
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);
  const [disablingMfa, setDisablingMfa] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName:'', lastName:'', gender:'', mobileNumber:'', dateOfBirth:'' });
  const [selfPuid, setSelfPuid] = useState(user?.puid || user?.userPuid || '');
  const [darkMode, setDarkMode] = useState(() => typeof window !== 'undefined' && document.documentElement.classList.contains('dark'));

  useEffect(() => {
    if (!user) return;
    const parts = String(user.name || user.user_metadata?.name || '').trim().split(/\s+/);
    setProfileForm({
      firstName:user.firstName || parts[0] || '',
      lastName:user.lastName || parts.slice(1).join(' ') || '',
      gender:user.gender || '',
      mobileNumber:user.mobileNumber || user.mobile || user.user_metadata?.mobile || '',
      dateOfBirth:user.dateOfBirth || ''
    });
    setSelfPuid(user.puid || user.userPuid || '');
    setTab('overview');
    setEditMode(false);
  }, [user, isOpen]);

  if (!isOpen || !user) return null;

  const email = user.email || user.user_metadata?.email || user.emailAddress || user.normalizedEmail || 'Email not available';
  const displayName = user.name || [user.firstName,user.lastName].filter(Boolean).join(' ') || user.user_metadata?.name || email.split('@')[0] || 'User';
  const mobile = user.mobileNumber || user.mobile || user.user_metadata?.mobile || 'Mobile not added';
  const emailVerified = Boolean(user.emailVerified);
  const mobileVerified = Boolean(user.mobileVerified);
  const savingProfile = isActionLoading(LOADING_ACTIONS.SAVE_PERSONAL_DETAILS);
  const signingOut = isActionLoading(LOADING_ACTIONS.SIGN_OUT);

  const saveProfile = async e => {
    e.preventDefault();
    await runAction(LOADING_ACTIONS.SAVE_PERSONAL_DETAILS, async () => {
      try { await updateProfile(profileForm); addToast('Profile details updated successfully.','success'); setEditMode(false); setTab('overview'); }
      catch(err){ addToast(err.message || t('couldNotUpdateProfile'),'error'); }
    });
  };

  const signOut = async () => { if(signingOut)return; await logout(); addToast('Signed out successfully','info'); onClose(); };
  const disable = async () => { setDisablingMfa(true); try { await disableMfa(); addToast(t('twoFactorDisabled'),'info'); } catch(e){addToast(e.message || t('couldNotDisable2fa'),'error');} finally{setDisablingMfa(false);} };

  return <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 backdrop-blur-[2px] animate-fade-in overscroll-none" aria-modal="true" role="dialog">
      <div
        className="modal-backdrop absolute inset-0 touch-none"
        onClick={onClose}
        onWheel={(e) => e.preventDefault()}
        onTouchMove={(e) => e.preventDefault()}
        aria-hidden="true"
      />
      <div className="pharma-modal-surface relative z-10 m-auto flex h-[92dvh] max-h-[56rem] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 text-slate-800 shadow-2xl overscroll-contain sm:h-[min(90dvh,56rem)]">
        <header className="relative shrink-0 bg-gradient-to-r from-blue-700 to-indigo-800 px-5 pt-5 pb-4 text-white w-full rounded-t-[28px]">
          <button onClick={onClose} aria-label={t("close")} className="absolute right-4 top-4 h-8 w-8 rounded-full bg-white/10 text-white/80 hover:bg-white/20">×</button>
          <div className="flex items-center gap-3 pr-8">
            <div className="h-14 w-14 shrink-0 rounded-2xl bg-white/15 ring-2 ring-white/20 overflow-hidden flex items-center justify-center text-xl font-black">
              {user.avatarUrl || user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                <img src={user.avatarUrl || user.user_metadata?.avatar_url || user.user_metadata?.picture} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black">{displayName}</h2>
              <p className="truncate text-xs text-blue-100">{email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-white/20 px-2 py-1 text-[9px] font-black uppercase text-white">{role}</span>
                {isSuperAdmin ? <span className="rounded-full bg-emerald-400/20 px-2 py-1 text-[9px] font-black text-emerald-200">{t('fullAccess')}</span> : !isSuperAdmin && selfPuid ? <span className="rounded-full bg-white/15 px-2 py-1 text-[9px] font-mono text-blue-100">PUID {selfPuid}</span> : null}
              </div>
            </div>
          </div>
        </header>

        <div role="tablist" className="grid grid-cols-3 gap-1 shrink-0 border-b border-slate-200 bg-slate-100/70 p-1.5">
          <TabButton active={tab==='overview'} onClick={()=>setTab('overview')}>{t('overview')}</TabButton>
          <TabButton active={tab==='personal'} onClick={()=>setTab('personal')}>{t('personal')}</TabButton>
          <TabButton active={tab==='security'} onClick={()=>setTab('security')}>{t('security')}</TabButton>
        </div>

        <main className="content-area min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {tab==='overview' && <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-bold text-slate-400">{t('emailAddress')}</p><p className="mt-1 truncate text-xs font-black text-slate-800" title={email}>{email}</p><p className={`mt-1 text-[9px] font-bold ${emailVerified?'text-emerald-600':'text-amber-600'}`}>{emailVerified?`✓ ${t('verified')}`:t('notVerified')}</p></div>
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[10px] font-bold text-slate-400">{t('mobileNumber')}</p><p className="mt-1 truncate text-xs font-black text-slate-800">{mobileVerified?`✓ ${t('verified')}`:mobile}</p></div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t('account')}</p>
              <div className="mt-2 space-y-2 text-xs"><div className="flex justify-between gap-3"><span className="text-slate-400">{t('role')}</span><b>{role}</b></div><div className="flex justify-between gap-3"><span className="text-slate-400">{t('status')}</span><b className="text-emerald-700">{user.accountStatus || t('active')}</b></div>{!isSuperAdmin && selfPuid && <div className="flex justify-between gap-3"><span className="text-slate-400">PUID</span><b className="font-mono text-[10px]">{selfPuid}</b></div>}</div>
            </div>
            {!isSuperAdmin && <RelativeProfiles user={user} onSelfPuid={setSelfPuid} />}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={()=>{onClose();onNavigate('orders')}} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] font-black hover:bg-slate-50">📦 Orders</button>
              <button onClick={()=>{onClose();onNavigate('addresses')}} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] font-black hover:bg-slate-50">🏠 Addresses</button>
              {canAccessOperations && <button onClick={()=>{onClose();onNavigate('admin')}} className="col-span-2 rounded-xl bg-blue-50 px-3 py-2.5 text-[11px] font-black text-blue-800 hover:bg-blue-100">⚙️ Open Operations Dashboard</button>}
            </div>
          </div>}

          {tab==='personal' && <div className="space-y-3">
            {!editMode ? <><div className="rounded-2xl border border-slate-200 p-4 space-y-3 text-xs"><div className="flex justify-between gap-4"><span className="text-slate-400">{t('fullName')}</span><b>{displayName}</b></div><div className="flex justify-between gap-4"><span className="text-slate-400">{t('gender')}</span><b>{user.gender || user.user_metadata?.gender || 'Not set'}</b></div><div className="flex justify-between gap-4"><span className="text-slate-400">{t('dateOfBirth')}</span><b>{user.dateOfBirth || 'Not set'}</b></div><div className="flex justify-between gap-4"><span className="text-slate-400">{t('mobileNumber')}</span><b>{mobile}</b></div></div><button onClick={()=>setEditMode(true)} className="w-full rounded-xl bg-blue-600 py-2.5 text-xs font-black text-white hover:bg-blue-700">{t('editPersonalDetails')}</button></> :
            <form onSubmit={saveProfile} className="space-y-3"><div className="grid grid-cols-2 gap-2"><input value={profileForm.firstName} onChange={e=>setProfileForm(p=>({...p,firstName:e.target.value}))} placeholder={t("firstName")} required className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs"/><input value={profileForm.lastName} onChange={e=>setProfileForm(p=>({...p,lastName:e.target.value}))} placeholder={t("lastName")} className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs"/></div><select value={profileForm.gender} onChange={e=>setProfileForm(p=>({...p,gender:e.target.value}))} required className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs"><option value="">{t("selectGenderOption")}</option><option value="MALE">{t("male")}</option><option value="FEMALE">{t("female")}</option><option value="OTHER">{t("other")}</option><option value="PREFER_NOT_TO_SAY">{t("preferNot")}</option></select><input type="date" value={profileForm.dateOfBirth} onChange={e=>setProfileForm(p=>({...p,dateOfBirth:e.target.value}))} required className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs"/><input value={profileForm.mobileNumber} onChange={e=>setProfileForm(p=>({...p,mobileNumber:e.target.value}))} required placeholder="+91 9876543210" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs"/><div className="flex gap-2"><button type="button" onClick={()=>setEditMode(false)} className="flex-1 rounded-xl bg-slate-100 py-2.5 text-xs font-black">{t('cancel')}</button><button type="submit" disabled={savingProfile} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-xs font-black text-white disabled:opacity-50">{savingProfile?t('savingAddress'):t('saveChanges')}</button></div></form>}
          </div>}

          {tab==='security' && <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div><h3 className="text-xs font-black text-slate-800">{t('darkMode')}</h3><p className="mt-1 text-[10px] text-slate-400">{t('toggleDarkTheme')}</p></div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !document.documentElement.classList.contains('dark');
                    document.documentElement.classList.toggle('dark', next);
                    localStorage.setItem('theme', next ? 'dark' : 'light');
                    setDarkMode(next);
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${document.documentElement.classList.contains('dark') ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${document.documentElement.classList.contains('dark') ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            {isSuperAdmin && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-black text-emerald-900">🛡️ {t('completePlatformAccess')}</p><p className="mt-1 text-[11px] text-emerald-800">{t('superAdminAccessNote')}</p></div>}
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between"><div><h3 className="text-xs font-black text-slate-800">{t('twoFactorAuth')}</h3><p className="mt-1 text-[10px] text-slate-400">{t('authenticatorProtection')}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-black ${mfaEnabled?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{mfaEnabled?t('active'):'OFF'}</span></div>
              {mfaEnabled ? <div className="mt-3 flex items-center justify-between"><span className="text-[10px] font-bold text-emerald-700">{t('assurance')} {aal?.toUpperCase()}</span><button onClick={disable} disabled={disablingMfa} className="text-[10px] font-black text-rose-600">{disablingMfa?t('disabling'):t('disable2fa')}</button></div> : <button onClick={()=>setEnrollModalOpen(true)} className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-[11px] font-black text-white">{t('enable2fa')}</button>}
            </div>
            {isSuperAdmin && <button onClick={()=>{onClose();onNavigate('admin');}} className="w-full rounded-xl bg-slate-900 py-2.5 text-[11px] font-black text-white">🛡️ Open Security Access Control</button>}
          </div>}
        </main>

        <footer className="border-t border-slate-100 p-3">
          <button onClick={signOut} disabled={signingOut} className="w-full rounded-xl bg-rose-50 py-2.5 text-xs font-black text-rose-700 disabled:opacity-50">{signingOut?'⏳ Signing out…':'🚪 Sign Out'}</button>
        </footer>
      </div>
    </div>
    <MFAEnrollmentModal isOpen={enrollModalOpen} onClose={()=>setEnrollModalOpen(false)} />
  </>;
}
