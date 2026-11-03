import React, { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';

export default function TenantProfileDashboard() {
  const { t } = useLanguage();
  const { addToast } = useToast();
  const { user, isSuperAdmin } = useAuth();

  const [vendorProfile, setVendorProfile] = useState({
    shopName: 'City Health Pharmacy & Wellness',
    legalName: 'City Health Pharma Pvt Ltd',
    licenseNumber: 'DL-2026-SF-99887',
    gstNumber: '27AABCC1234F1Z9',
    address: { street: '123 Main Street', city: 'San Francisco', state: 'CA', zipCode: '94105' },
    ownerDetails: { name: 'Ashvin Singh', email: 'ashvinsingh25@gmail.com', phone: '+19876543210' }
  });
  const [branches, setBranches] = useState([
    {
      id: 'branch-1',
      name: 'Downtown Flagship Dispensary',
      status: 'ACTIVE',
      location: '123 Main Street, San Francisco, CA',
      serviceRadiusKm: 12,
      minimumOrderValue: 150,
      managerName: 'Robert Vance',
      managerPhone: '+1 415 555 0199',
      managerEmail: 'robert.vance@cityhealth.com'
    },
    {
      id: 'branch-2',
      name: 'Northside Express Hub',
      status: 'ACTIVE',
      location: '456 Health Ave, San Francisco, CA',
      serviceRadiusKm: 15,
      minimumOrderValue: 200,
      managerName: 'Sarah Jenkins',
      managerPhone: '+1 415 555 0144',
      managerEmail: 'sarah.j@cityhealth.com'
    }
  ]);
  const [personnel, setPersonnel] = useState([
    { _id: 'p-1', name: 'Ashvin Singh', email: 'ashvinsingh25@gmail.com', role: 'OWNER' },
    { _id: 'p-2', name: 'Jane Admin', email: 'jane.admin@pharmacy.com', role: 'TENANT_ADMIN' }
  ]);
  const [error, setError] = useState('');

  // Modal for adding/editing branch & branch manager
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [branchForm, setBranchForm] = useState({
    name: '',
    location: '',
    serviceRadiusKm: 12,
    minimumOrderValue: 150,
    managerName: '',
    managerPhone: '',
    managerEmail: '',
    status: 'ACTIVE'
  });
  const [submittingBranch, setSubmittingBranch] = useState(false);

  const loadData = async () => {
    try {
      const profileRes = await apiClient.get('/api/vendor/profile').catch(() => ({ data: null }));
      const branchRes = await apiClient.get('/api/tenant/branches').catch(() => ({ data: null }));

      if (profileRes?.data?.tenant) {
        setVendorProfile(profileRes.data.tenant);
      }
      if (profileRes?.data?.personnel) {
        setPersonnel(profileRes.data.personnel);
      }
      if (branchRes?.data?.branches) {
        setBranches(branchRes.data.branches);
      }
    } catch (err) {
      // Keep defaults
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleOpenBranchModal = (branch = null) => {
    if (branch) {
      setEditingBranch(branch);
      setBranchForm({
        name: branch.name || '',
        location: branch.location || '',
        serviceRadiusKm: branch.serviceRadiusKm || 12,
        minimumOrderValue: branch.minimumOrderValue || 150,
        managerName: branch.managerName || '',
        managerPhone: branch.managerPhone || '',
        managerEmail: branch.managerEmail || '',
        status: branch.status || 'ACTIVE'
      });
    } else {
      setEditingBranch(null);
      setBranchForm({
        name: '',
        location: '',
        serviceRadiusKm: 12,
        minimumOrderValue: 150,
        managerName: '',
        managerPhone: '',
        managerEmail: '',
        status: 'ACTIVE'
      });
    }
    setBranchModalOpen(true);
  };

  const handleSaveBranch = async (e) => {
    e.preventDefault();
    if (!branchForm.name || !branchForm.location) {
      addToast(t('branchDetailsRequired'), 'warning');
      return;
    }

    setSubmittingBranch(true);
    try {
      // Simulate saving branch and updating branch manager
      await new Promise(resolve => setTimeout(resolve, 600));
      if (editingBranch) {
        setBranches(prev => prev.map(b => (b.id === editingBranch.id ? { ...b, ...branchForm } : b)));
        addToast(`Successfully updated branch "${branchForm.name}"!`, 'success');
      } else {
        const newBranch = {
          id: `branch-${Date.now()}`,
          ...branchForm
        };
        setBranches(prev => [newBranch, ...prev]);
        addToast(`Successfully linked new branch "${branchForm.name}"!`, 'success');
      }
      setBranchModalOpen(false);
    } catch (err) {
      addToast(t('branchSaveFailed'), 'error');
    } finally {
      setSubmittingBranch(false);
    }
  };



  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-800 to-purple-800 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/10 skew-x-12 pointer-events-none" />
        <div className="relative z-10 space-y-1">
          <span className="text-[10px] font-black uppercase tracking-wider bg-white/20 px-3 py-1 rounded-full text-blue-100">
            {t('tenantProfileControl')}
          </span>
          <h2 className="text-xl sm:text-2xl font-black mt-2">
            {vendorProfile?.shopName || 'QuickMeds Rx & Dispensary'}
          </h2>
          <p className="text-xs text-blue-100 max-w-xl">
            {t('manageOrgCredentials')}
          </p>
        </div>
        <div className="relative z-10 flex gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => handleOpenBranchModal()}
            className="flex-1 sm:flex-initial px-5 py-3 bg-white text-blue-900 font-black text-xs rounded-2xl shadow-md hover:bg-blue-50 transition cursor-pointer"
          >
            {t('linkAddNewBranch')}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-bold">
          ⚠️ {error}
        </div>
      )}

      {/* Grid: Company Credentials & Personnel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Company Details Card */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">🏢 {t('orgLicenseCredentials')}</h3>
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase">{t('verifiedTenant')}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">{t('legalEntityName')}</span>
              <span className="font-black text-slate-900 text-sm mt-0.5 block">{vendorProfile?.legalName || 'Ashvin Pharma Corp'}</span>
            </div>
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">{t('drugLicenseNumber')}</span>
              <span className="font-black font-mono text-blue-700 text-sm mt-0.5 block">{vendorProfile?.licenseNumber || 'DL-2026-SF-99887'}</span>
            </div>
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">{t('gstTaxId')}</span>
              <span className="font-black font-mono text-slate-900 text-sm mt-0.5 block">{vendorProfile?.gstNumber || '27AABCC1234F1Z9'}</span>
            </div>
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
              <span className="text-slate-400 font-bold block text-[10px] uppercase">{t('primarySupportEmail')}</span>
              <span className="font-black text-slate-900 text-sm mt-0.5 block">{vendorProfile?.ownerDetails?.email || user?.email || 'support@ashvinpharmacy.in'}</span>
            </div>
          </div>

          <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-2xl space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-800">{t('primaryRegisteredAddress')}</span>
            <p className="text-xs font-bold text-slate-800">
              {vendorProfile?.address?.street || '123 Main Street'}, {vendorProfile?.address?.city || 'San Francisco'}, {vendorProfile?.address?.state || 'CA'} — {vendorProfile?.address?.zipCode || '94105'}
            </p>
          </div>
        </div>

        {/* Personnel & Key Staff Roster */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">👥 {t('tenantPersonnel')}</h3>
            <span className="text-xs font-bold text-slate-400">{personnel.length} {t('staffCount')}</span>
          </div>
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {personnel.map((p) => (
              <div key={p._id || p.id} className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-xs font-black text-slate-900 truncate">{p.name}</h4>
                  <p className="text-[11px] text-slate-500 truncate">{p.email}</p>
                </div>
                <span className="shrink-0 rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[9px] font-black uppercase">
                  {p.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Associated Branch Locations & Branch Manager Section */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">📍 {t('associatedBranchLocations')}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{t('tenantProfileBranches')}</p>
          </div>
          <button
            type="button"
            onClick={() => handleOpenBranchModal()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
          >
            {t('addBranchLocation')}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {branches.map((branch) => (
            <div key={branch.id || branch._id} className="border border-slate-200 rounded-2xl p-5 bg-slate-50/50 space-y-3 hover:border-blue-300 transition">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-mono font-bold text-slate-400">ID: {branch.id || branch._id}</span>
                  <h4 className="text-sm font-black text-slate-900 mt-0.5">{branch.name}</h4>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${branch.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                  {branch.status || 'ACTIVE'}
                </span>
              </div>

              <div className="text-xs space-y-1.5 text-slate-600">
                <div>📍 <strong>{t('branchLocation')}:</strong> {branch.location}</div>
                <div>📡 <strong>{t('serviceRadius')}:</strong> {branch.serviceRadiusKm || 12} km</div>
                <div>💳 <strong>{t('minimumOrderValue')}:</strong> ₹{branch.minimumOrderValue || 150}</div>
              </div>

              {/* Branch Manager Cover Box */}
              <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">👤 {t('branchManagerCover')}</span>
                  <button
                    type="button"
                    onClick={() => handleOpenBranchModal(branch)}
                    className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                  >
                    {t('editChangeManager')}
                  </button>
                </div>
                <div className="text-xs font-black text-slate-900">{branch.managerName || t('unassignedManager')}</div>
                <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                  <span>📞 {branch.managerPhone || t('noPhone')}</span>
                  <span>✉️ {branch.managerEmail || t('emailAddress')}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add / Edit Branch Modal */}
      {branchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-[2px] animate-fade-in overscroll-none" aria-modal="true" role="dialog">
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 bg-white flex justify-between items-center">
              <h3 className="text-base font-black text-slate-900">
                {editingBranch ? t('editBranchDetails') : t('linkNewBranchLocation')}
              </h3>
              <button
                onClick={() => setBranchModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBranch} className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('branchName')} *</label>
                  <input
                    type="text"
                    required
                    value={branchForm.name}
                    onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                    placeholder="e.g. Westend Wellness Depot"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('status')}</label>
                  <select
                    value={branchForm.status}
                    onChange={(e) => setBranchForm({ ...branchForm, status: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ACTIVE">{t('active')}</option>
                    <option value="MAINTENANCE">{t('maintenance')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('address')} *</label>
                <input
                  type="text"
                  required
                  value={branchForm.location}
                  onChange={(e) => setBranchForm({ ...branchForm, location: e.target.value })}
                  placeholder="e.g. 789 Care Blvd, San Francisco, CA"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('serviceRadius')} (KM)</label>
                  <input
                    type="number"
                    value={branchForm.serviceRadiusKm}
                    onChange={(e) => setBranchForm({ ...branchForm, serviceRadiusKm: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('minimumOrderValue')} (₹)</label>
                  <input
                    type="number"
                    value={branchForm.minimumOrderValue}
                    onChange={(e) => setBranchForm({ ...branchForm, minimumOrderValue: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <h4 className="text-xs font-black uppercase text-blue-700">{t('branchManagerAssignment')}</h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('managerName')}</label>
                    <input
                      type="text"
                      value={branchForm.managerName}
                      onChange={(e) => setBranchForm({ ...branchForm, managerName: e.target.value })}
                      placeholder="e.g. Robert Vance"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('managerPhone')}</label>
                    <input
                      type="text"
                      value={branchForm.managerPhone}
                      onChange={(e) => setBranchForm({ ...branchForm, managerPhone: e.target.value })}
                      placeholder="+1 415 555 0199"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">{t('managerEmail')}</label>
                    <input
                      type="email"
                      value={branchForm.managerEmail}
                      onChange={(e) => setBranchForm({ ...branchForm, managerEmail: e.target.value })}
                      placeholder="robert@pharma.com"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBranchModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submittingBranch}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md cursor-pointer disabled:opacity-50"
                >
                  {submittingBranch ? t('savingBranch') : t('saveAndLinkBranch')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
