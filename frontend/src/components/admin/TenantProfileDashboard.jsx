import React, { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import TenantRegistry from '../auth/TenantRegistry';
import TenantBranchTeamManager from './TenantBranchTeamManager';

const emptyProfile = {
  shopName: '', legalName: '', licenseNumber: '', gstNumber: '',
  address: { street: '', city: '', state: '', zipCode: '' },
  geolocation: { latitude: '', longitude: '' },
  usesTenantAsBranch: false,
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

export default function TenantProfileDashboard({ tenantId: platformTenantId = '', showTenantSelector = true } = {}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const role = String(user?.app_metadata?.role || user?.role || '').toUpperCase();
  const isSuperAdmin = ['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'ADMIN'].includes(role);
  const [availableTenants, setAvailableTenants] = useState([]);
  const [internalTenantId, setInternalTenantId] = useState('');
  const selectedTenantId = platformTenantId || internalTenantId;
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [profile, setProfile] = useState(emptyProfile);
  const [draft, setDraft] = useState(emptyProfile);
  const [personnel, setPersonnel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);
  const [pharmacyCanEdit, setPharmacyCanEdit] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [branchRegistryVersion, setBranchRegistryVersion] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const profileRequestVersion = useRef(0);

  const loadProfile = useCallback(async () => {
    const requestVersion = ++profileRequestVersion.current;
    if (isSuperAdmin && !selectedTenantId) {
      setProfile(emptyProfile); setDraft(emptyProfile); setPersonnel([]); setProfileMissing(false);
      setLoading(false); return;
    }
    if (isSuperAdmin) { setProfile(emptyProfile); setDraft(emptyProfile); setPersonnel([]); setProfileMissing(false); setPharmacyCanEdit(false); }
    setLoading(true);
    setError('');
    try {
      const [profileResponse, policyResponse] = await Promise.all([
        apiClient.get('/api/v1/vendor/profile', { params: isSuperAdmin ? { tenantId: selectedTenantId } : undefined }),
        apiClient.get('/api/v1/vendor/profile/edit-policy', { params: isSuperAdmin ? { tenantId: selectedTenantId } : undefined })
      ]);
      if (requestVersion !== profileRequestVersion.current) return;
      const payload = profileResponse.data?.data || profileResponse.data || {};
      const tenant = payload.tenant || {};
      const nextProfile = {
        ...emptyProfile,
        ...tenant,
        address: { ...emptyProfile.address, ...(tenant.address || {}) },
        geolocation: { ...emptyProfile.geolocation, ...(tenant.geolocation || {}) },
        usesTenantAsBranch: tenant.usesTenantAsBranch === true,
        ownerDetails: { ...emptyProfile.ownerDetails, ...(tenant.ownerDetails || {}) }
      };
      setProfile(nextProfile);
      setDraft(nextProfile);
      setPersonnel(Array.isArray(payload.personnel) ? payload.personnel : []);
      setProfileMissing(!payload.profileConfigured);
      setPharmacyCanEdit(policyResponse.data?.data?.pharmacyCanEdit === true);
    } catch (err) {
      if (requestVersion === profileRequestVersion.current) {
        setProfile(emptyProfile); setDraft(emptyProfile); setPersonnel([]);
        setError(err?.response?.data?.message || err.message || 'Pharmacy profile could not be loaded.');
      }
    } finally {
      if (requestVersion === profileRequestVersion.current) setLoading(false);
    }
  }, [isSuperAdmin, selectedTenantId]);

  useEffect(() => {
    if (!isSuperAdmin || !showTenantSelector || platformTenantId) return;
    let cancelled = false;
    setTenantsLoading(true);
    apiClient.get('/api/v1/admin/tenants')
      .then(response => {
        if (cancelled) return;
        const raw = response.data?.data || response.data?.tenants || response.data || [];
        const items = Array.isArray(raw) ? raw : (raw.tenants || []);
        const valid = items.filter(item => item && (item.id || item._id));
        setAvailableTenants(valid);
        setSelectedTenantId(current => current && valid.some(item => String(item.id || item._id) === String(current)) ? current : String(valid[0]?.id || valid[0]?._id || ''));
      })
      .catch(err => { if (!cancelled) setError(err?.response?.data?.message || err.message || 'Could not load platform tenants.'); })
      .finally(() => { if (!cancelled) setTenantsLoading(false); });
    return () => { cancelled = true; };
  }, [isSuperAdmin, showTenantSelector, platformTenantId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const canEdit = isSuperAdmin || pharmacyCanEdit;
  const address = [profile.address.street, profile.address.city, profile.address.state, profile.address.zipCode].filter(Boolean).join(', ');
  const updateDraft = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const updateAddress = (field, value) => setDraft(current => ({ ...current, address: { ...current.address, [field]: value } }));
  const updateOwner = (field, value) => setDraft(current => ({ ...current, ownerDetails: { ...current.ownerDetails, [field]: value } }));
  const updateGeolocation = (field, value) => setDraft(current => ({ ...current, geolocation: { ...current.geolocation, [field]: value } }));
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('Location is not supported by this browser. Enter coordinates manually.'); return; }
    setError('');
    navigator.geolocation.getCurrentPosition(
      position => setDraft(current => ({ ...current, geolocation: { latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) } })),
      locationError => setError(locationError.code === 1 ? 'Location permission was denied. Enter coordinates manually or allow location access.' : 'Could not get your location. Check device location settings and try again.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const saveProfile = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.patch('/api/v1/vendor/profile', {
        ...(isSuperAdmin ? { tenantId: selectedTenantId } : {}),
        shopName: draft.shopName, legalName: draft.legalName,
        licenseNumber: draft.licenseNumber, gstNumber: draft.gstNumber,
        address: draft.address,
        geolocation: draft.geolocation,
        usesTenantAsBranch: draft.usesTenantAsBranch === true,
        contactEmail: draft.ownerDetails.email,
        contactPhone: draft.ownerDetails.phone
      });
      const updated = response.data?.data?.tenant || draft;
      const next = { ...draft, ...updated, address: { ...draft.address, ...(updated.address || {}) }, ownerDetails: { ...draft.ownerDetails, ...(updated.ownerDetails || {}) } };
      setProfile(next);
      setDraft(next);
      setEditing(false);
      setNotice(response.data?.message || 'Pharmacy details saved.');
      setBranchRegistryVersion(version => version + 1);
    } catch (err) {
      setError(err?.response?.data?.message || 'Pharmacy details could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const changePolicy = async enabled => {
    setPolicySaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.patch('/api/v1/vendor/profile/edit-policy', { ...(isSuperAdmin ? { tenantId: selectedTenantId } : {}), pharmacyCanEdit: enabled });
      setPharmacyCanEdit(response.data?.data?.pharmacyCanEdit === true);
      setNotice(enabled ? 'Pharmacy editing has been enabled.' : 'Pharmacy editing has been disabled.');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not update pharmacy edit permission.');
    } finally {
      setPolicySaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {isSuperAdmin && showTenantSelector && !platformTenantId && (
        <section className="rounded-3xl border border-violet-200 bg-white p-5 shadow-sm">
          <label className="block text-xs font-black uppercase tracking-wide text-slate-600" htmlFor="super-admin-tenant-select">Select pharmacy tenant</label>
          <select id="super-admin-tenant-select" value={selectedTenantId} onChange={event => { setInternalTenantId(event.target.value); setEditing(false); setError(''); setNotice(''); }} disabled={tenantsLoading || availableTenants.length === 0} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-900">
            {availableTenants.length === 0 && <option value="">{tenantsLoading ? 'Loading tenants…' : 'No tenants available'}</option>}
            {availableTenants.map(tenant => <option key={tenant.id || tenant._id} value={tenant.id || tenant._id}>{tenant.name || tenant.legalName || tenant.id || tenant._id} · {tenant.status || 'UNKNOWN'}</option>)}
          </select>
          <p className="mt-2 text-xs text-slate-500">Profile, edit permissions, personnel and branches below are loaded only for this selected tenant.</p>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">{t('tenantProfileControl')}</span>
            <h2 className="mt-2 text-2xl font-black text-slate-900">{profile.shopName || 'Tenant Profile'}</h2>
            <p className="mt-1 text-sm text-slate-500">Pharmacy details and branch registry are loaded from the selected tenant.</p>
          </div>
          <button type="button" onClick={loadProfile} disabled={loading} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh profile'}
          </button>
        </div>
      </section>

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
      {notice && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {isSuperAdmin && (
        <section className="flex flex-col justify-between gap-4 rounded-3xl border border-violet-200 bg-violet-50 p-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-black text-violet-950">Pharmacy profile edit permission</h3>
            <p className="mt-1 text-sm text-violet-800">Control whether this pharmacy's administrators can edit their registered details.</p>
            <p className="mt-1 text-xs font-semibold text-violet-700">Current setting: {pharmacyCanEdit ? 'Pharmacy can edit' : 'Read-only for pharmacy'}</p>
          </div>
          <button type="button" disabled={policySaving || loading} onClick={() => changePolicy(!pharmacyCanEdit)} className="rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            {policySaving ? 'Saving…' : pharmacyCanEdit ? 'Disable pharmacy editing' : 'Allow pharmacy editing'}
          </button>
        </section>
      )}

      {profileMissing && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Pharmacy profile setup is incomplete.</strong>
          <p className="mt-1">Registered details will appear as they are added. Branch setup remains available below.</p>
        </div>
      )}

      <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">Pharmacy details</h3>
            <p className="mt-1 text-xs text-slate-500">Tenant: {profile.shopName || 'Profile not configured'} · {user?.email || 'Signed-in user'}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isSuperAdmin && <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">{pharmacyCanEdit ? 'EDITING ALLOWED' : 'READ ONLY'}</span>}
            {canEdit && !editing && <button type="button" onClick={() => { setDraft(profile); setEditing(true); }} className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Edit details</button>}
          </div>
        </div>

        {loading ? <div className="py-8 text-center text-sm text-slate-500">Loading pharmacy profile…</div> : editing ? (
          <form onSubmit={saveProfile} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              ['shopName', 'Pharmacy name'], ['legalName', 'Legal name'],
              ['licenseNumber', 'Drug licence number'], ['gstNumber', 'GST number']
            ].map(([field, label]) => (
              <label key={field} className="space-y-1 text-xs font-bold text-slate-600">{label}
                <input value={draft[field] || ''} onChange={event => updateDraft(field, event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium text-slate-900" />
              </label>
            ))}
            {[
              ['street', 'Street address'], ['city', 'City'], ['state', 'State'], ['zipCode', 'PIN code']
            ].map(([field, label]) => (
              <label key={field} className="space-y-1 text-xs font-bold text-slate-600">{label}
                <input value={draft.address[field] || ''} onChange={event => updateAddress(field, event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium text-slate-900" />
              </label>
            ))}
            {[['email', 'Contact email'], ['phone', 'Contact phone']].map(([field, label]) => (
              <label key={field} className="space-y-1 text-xs font-bold text-slate-600">{label}
                <input type={field === 'email' ? 'email' : 'tel'} value={draft.ownerDetails[field] || ''} onChange={event => updateOwner(field, event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium text-slate-900" />
              </label>
            ))}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:col-span-2">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-700" checked={draft.usesTenantAsBranch === true} onChange={event => updateDraft('usesTenantAsBranch', event.target.checked)} />
              <span>
                <span className="block text-sm font-extrabold text-emerald-950">I don't have separate branches — use tenant as the main branch</span>
                <span className="mt-1 block text-xs leading-5 text-emerald-800">The tenant's name, address and geolocation will be used as the main branch. Turn this off before adding separate branches.</span>
              </span>
            </label>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-sm font-bold text-slate-800">Pharmacy geolocation</p><p className="text-xs text-slate-500">Set the registered pharmacy's map coordinates.</p></div>
                <button type="button" onClick={useCurrentLocation} className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700">Use current location</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-bold text-slate-600">Latitude
                  <input type="number" step="any" min="-90" max="90" value={draft.geolocation?.latitude ?? ''} onChange={event => updateGeolocation('latitude', event.target.value)} placeholder="e.g. 12.971599" className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium text-slate-900" />
                </label>
                <label className="space-y-1 text-xs font-bold text-slate-600">Longitude
                  <input type="number" step="any" min="-180" max="180" value={draft.geolocation?.longitude ?? ''} onChange={event => updateGeolocation('longitude', event.target.value)} placeholder="e.g. 77.594566" className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-medium text-slate-900" />
                </label>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" disabled={saving} className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save pharmacy details'}</button>
              <button type="button" disabled={saving} onClick={() => { setDraft(profile); setEditing(false); }} className="rounded-xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700">Cancel</button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ProfileField label="Pharmacy name" value={profile.shopName} />
            <ProfileField label="Legal name" value={profile.legalName} />
            <ProfileField label="Drug licence number" value={profile.licenseNumber} />
            <ProfileField label="GST number" value={profile.gstNumber} />
            <ProfileField label="Registered address" value={address} />
            <ProfileField label="Geolocation" value={profile.geolocation?.latitude != null && profile.geolocation?.longitude != null ? `${profile.geolocation.latitude}, ${profile.geolocation.longitude}` : ''} />
            <ProfileField label="Branch setup" value={profile.usesTenantAsBranch ? 'Tenant is the main branch' : 'Separate branches'} />
            <ProfileField label="Owner / contact" value={profile.ownerDetails.name} />
            <ProfileField label="Contact email" value={profile.ownerDetails.email} />
            <ProfileField label="Contact phone" value={profile.ownerDetails.phone} />
          </div>
        )}
        {!isSuperAdmin && !pharmacyCanEdit && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Your Super Admin has disabled pharmacy profile editing. You can still view these details.</p>}
      </section>

      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div><h3 className="text-sm font-black uppercase tracking-wide text-slate-900">Tenant personnel</h3><p className="mt-1 text-xs text-slate-500">Authorized users linked to this pharmacy</p></div>
          <span className="text-xs font-bold text-slate-500">{personnel.length} members</span>
        </div>
        {personnel.length ? personnel.map(member => (
          <div key={member._id || member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
            <div><p className="text-sm font-bold text-slate-800">{member.name || 'Name not added'}</p><p className="text-xs text-slate-500">{member.email || 'Email not added'}</p></div>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">{member.role}</span>
          </div>
        )) : <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">No personnel records are available yet.</p>}
      </section>

      <TenantBranchTeamManager tenantId={selectedTenantId || ''} />

      <section className="space-y-3">
        <div><h3 className="text-lg font-black text-slate-900">Tenant branches</h3><p className="text-sm text-slate-500">Create and activate branches for this pharmacy.</p></div>
        {isSuperAdmin && !selectedTenantId
          ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Select a tenant above to view its branch registry.</p>
          : <TenantRegistry key={`${branchRegistryVersion}-${selectedTenantId}`} tenantId={isSuperAdmin ? selectedTenantId : undefined} />}
      </section>
    </div>
  );
}
