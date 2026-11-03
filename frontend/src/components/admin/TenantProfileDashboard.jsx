import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import TenantRegistry from '../auth/TenantRegistry';

const emptyProfile = {
  shopName: '',
  legalName: '',
  licenseNumber: '',
  gstNumber: '',
  address: { street: '', city: '', state: '', zipCode: '' },
  ownerDetails: { name: '', email: '', phone: '' }
};

function ProfileField({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="mt-1 block break-words text-sm font-semibold text-slate-900">
        {value || <span className="font-medium italic text-slate-400">Not added yet</span>}
      </span>
    </div>
  );
}

export default function TenantProfileDashboard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [profile, setProfile] = useState(emptyProfile);
  const [personnel, setPersonnel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileMissing, setProfileMissing] = useState(false);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    setProfileMissing(false);
    try {
      const response = await apiClient.get('/api/vendor/profile');
      const tenant = response.data?.tenant || {};
      setProfile({
        ...emptyProfile,
        ...tenant,
        address: { ...emptyProfile.address, ...(tenant.address || {}) },
        ownerDetails: { ...emptyProfile.ownerDetails, ...(tenant.ownerDetails || {}) }
      });
      setPersonnel(Array.isArray(response.data?.personnel) ? response.data.personnel : []);
      setProfileMissing(!response.data?.profileConfigured);
    } catch (err) {
      if (err?.response?.status === 404 && err?.response?.data?.code === 'TENANT_PROFILE_NOT_FOUND') {
        setProfile(emptyProfile);
        setPersonnel([]);
        setProfileMissing(true);
      } else {
        setError(err?.response?.data?.message || err.message || 'Pharmacy profile could not be loaded.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const address = [profile.address.street, profile.address.city, profile.address.state, profile.address.zipCode].filter(Boolean).join(', ');

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">{t('tenantProfileControl')}</span>
            <h2 className="mt-2 text-2xl font-black text-slate-900">{profile.shopName || 'Tenant Profile'}</h2>
            <p className="mt-1 text-sm text-slate-500">Your pharmacy profile and branch registry remain available even before setup is completed.</p>
          </div>
          <button type="button" onClick={loadProfile} disabled={loading} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh profile'}
          </button>
        </div>
      </section>

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

      {profileMissing && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Pharmacy profile setup is incomplete.</strong>
          <p className="mt-1">This page is available now. Profile fields will appear as they are registered; branch setup can continue below.</p>
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">Pharmacy details</h3>
            <p className="mt-1 text-xs text-slate-500">Authenticated tenant profile · {user?.email || 'Signed-in pharmacy user'}</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">{profileMissing ? 'SETUP PENDING' : 'PROFILE'}</span>
        </div>
        {loading ? <div className="py-8 text-center text-sm text-slate-500">Loading pharmacy profile…</div> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ProfileField label="Pharmacy name" value={profile.shopName} />
            <ProfileField label="Legal name" value={profile.legalName} />
            <ProfileField label="Drug licence number" value={profile.licenseNumber} />
            <ProfileField label="GST number" value={profile.gstNumber} />
            <ProfileField label="Registered address" value={address} />
            <ProfileField label="Owner / contact" value={profile.ownerDetails.name} />
            <ProfileField label="Contact email" value={profile.ownerDetails.email} />
            <ProfileField label="Contact phone" value={profile.ownerDetails.phone} />
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">Tenant personnel</h3>
            <p className="mt-1 text-xs text-slate-500">Authorized users linked to this pharmacy</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{personnel.length} members</span>
        </div>
        {personnel.length ? personnel.map(member => (
          <div key={member._id || member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
            <div><p className="text-sm font-bold text-slate-800">{member.name || 'Name not added'}</p><p className="text-xs text-slate-500">{member.email || 'Email not added'}</p></div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">{member.role}</span>
          </div>
        )) : <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">No personnel records are available yet. This section remains open while your team is being configured.</p>}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-black text-slate-900">Tenant branches</h3>
          <p className="text-sm text-slate-500">Create and activate branches for this pharmacy. Empty branch data will not hide this section.</p>
        </div>
        <TenantRegistry />
      </section>
    </div>
  );
}
