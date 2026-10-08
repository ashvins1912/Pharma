import React, { useState, useEffect, useMemo } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';

export default function PlatformTenantsView() {
  const { user, isSuperAdmin } = useAuth();

  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Filtering & search
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'PENDING'
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [onboardModalOpen, setOnboardModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [tenantDetails, setTenantDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Form states for Onboard Tenant
  const [onboardForm, setOnboardForm] = useState({
    name: '',
    slug: '',
    legalName: '',
    contactEmail: '',
    contactPhone: '',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    initialAdminEmail: ''
  });
  const [submittingOnboard, setSubmittingOnboard] = useState(false);
  const [onboardError, setOnboardError] = useState('');

  // Form states for Invite Admin
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    branchId: ''
  });
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [issuedInvitation, setIssuedInvitation] = useState(null);

  // Vendor Onboarding State
  const [platformTab, setPlatformTab] = useState('tenants'); // 'tenants' | 'vendors'
  const [vendors, setVendors] = useState([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendorForm, setVendorForm] = useState({
    name: '',
    companyName: '',
    email: '',
    mobile: '',
    gstNumber: '',
    street: '',
    city: '',
    state: '',
    pincode: ''
  });
  const [submittingVendor, setSubmittingVendor] = useState(false);
  const [vendorError, setVendorError] = useState('');
  const [invitedVendorResult, setInvitedVendorResult] = useState(null);
  const [resendingVendorId, setResendingVendorId] = useState(null);

  // Status toggle confirmation
  const [statusActionPending, setStatusActionPending] = useState(null); // { tenantId, action: 'suspend' | 'activate' }

  const loadTenants = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiClient.get('/api/v1/admin/tenants');
      const items = res.data?.data || [];
      setTenants(Array.isArray(items) ? items : []);
    } catch (err) {
      setError(err.message || 'Could not load platform tenants.');
    } finally {
      setLoading(false);
    }
  };

  const loadVendors = async () => {
    try {
      setLoadingVendors(true);
      const res = await apiClient.get('/api/v1/vendors');
      const items = res.data?.data || [];
      setVendors(Array.isArray(items) ? items : []);
    } catch (err) {
      console.warn('Could not load vendors:', err.message);
    } finally {
      setLoadingVendors(false);
    }
  };

  useEffect(() => {
    loadTenants();
    loadVendors();
  }, []);

  // Filtered tenants calculation
  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery = !q ||
        t.name?.toLowerCase().includes(q) ||
        t.slug?.toLowerCase().includes(q) ||
        t.code?.toLowerCase().includes(q) ||
        t.contactEmail?.toLowerCase().includes(q) ||
        t.id?.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [tenants, statusFilter, searchQuery]);

  // Derived counts
  const totalCount = tenants.length;
  const activeCount = tenants.filter(t => t.status === 'ACTIVE').length;
  const suspendedCount = tenants.filter(t => t.status === 'SUSPENDED').length;
  const pendingCount = tenants.filter(t => t.status === 'PENDING').length;

  // Handle Tenant Onboarding Submission
  const handleOnboardSubmit = async (e) => {
    e.preventDefault();
    if (!onboardForm.name.trim()) {
      setOnboardError('Pharmacy Name is required.');
      return;
    }

    try {
      setSubmittingOnboard(true);
      setOnboardError('');
      const payload = {
        name: onboardForm.name.trim(),
        slug: onboardForm.slug.trim() || undefined,
        legalName: onboardForm.legalName.trim() || undefined,
        contactEmail: onboardForm.contactEmail.trim() || undefined,
        contactPhone: onboardForm.contactPhone.trim() || undefined,
        timezone: onboardForm.timezone,
        currency: onboardForm.currency,
        status: 'ACTIVE'
      };

      const res = await apiClient.post('/api/v1/admin/tenants', payload);
      const created = res.data?.data;

      // If initial admin email was specified, trigger invite immediately
      if (onboardForm.initialAdminEmail.trim() && created?.id) {
        try {
          await apiClient.post(`/api/v1/admin/tenants/${created.id}/invite-admin`, {
            email: onboardForm.initialAdminEmail.trim()
          });
        } catch (inviteErr) {
          console.warn('Initial admin invite warning:', inviteErr.message);
        }
      }

      setActionSuccess(`Tenant "${created?.name || payload.name}" onboarded successfully.`);
      setOnboardModalOpen(false);
      setOnboardForm({
        name: '',
        slug: '',
        legalName: '',
        contactEmail: '',
        contactPhone: '',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        initialAdminEmail: ''
      });
      await loadTenants();
    } catch (err) {
      setOnboardError(err.message || 'Failed to onboard tenant.');
    } finally {
      setSubmittingOnboard(false);
    }
  };

  // Handle Tenant Status Toggle (Suspend / Activate)
  const handleToggleStatus = async (tenant, action) => {
    try {
      setStatusActionPending(tenant.id);
      setError('');
      const endpoint = `/api/v1/admin/tenants/${tenant.id}/${action}`;
      await apiClient.post(endpoint);
      setActionSuccess(`Tenant "${tenant.name}" has been ${action === 'suspend' ? 'suspended' : 'activated'}.`);
      await loadTenants();
    } catch (err) {
      setError(`Failed to ${action} tenant: ${err.message}`);
    } finally {
      setStatusActionPending(null);
    }
  };

  // Open Invite Admin Modal for a specific tenant
  const openInviteModal = (tenant) => {
    setSelectedTenant(tenant);
    setInviteForm({ email: '', name: '', branchId: '' });
    setInviteError('');
    setIssuedInvitation(null);
    setInviteModalOpen(true);
  };

  // Submit Admin Invitation
  const handleInviteSubmit = async (e) => {
    e.preventDefault();
    if (!inviteForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteForm.email.trim())) {
      setInviteError('Please provide a valid administrator email address.');
      return;
    }

    try {
      setSubmittingInvite(true);
      setInviteError('');
      const res = await apiClient.post(`/api/v1/admin/tenants/${selectedTenant.id}/invite-admin`, {
        email: inviteForm.email.trim(),
        name: inviteForm.name.trim() || undefined,
        branchId: inviteForm.branchId || null
      });

      setIssuedInvitation(res.data?.data);
      setActionSuccess(`Invitation issued to ${inviteForm.email.trim()}.`);
      // Keep modal open to show token details
    } catch (err) {
      setInviteError(err.message || 'Could not issue administrator invitation.');
    } finally {
      setSubmittingInvite(false);
    }
  };

  // Submit Vendor Invitation
  const handleVendorSubmit = async (e) => {
    e.preventDefault();
    if (!vendorForm.name.trim() || !vendorForm.email.trim()) {
      setVendorError('Vendor name and email address are required.');
      return;
    }

    try {
      setSubmittingVendor(true);
      setVendorError('');
      const payload = {
        name: vendorForm.name.trim(),
        companyName: vendorForm.companyName.trim() || vendorForm.name.trim(),
        email: vendorForm.email.trim(),
        mobile: vendorForm.mobile.trim(),
        gstNumber: vendorForm.gstNumber.trim(),
        address: {
          street: vendorForm.street.trim(),
          city: vendorForm.city.trim(),
          state: vendorForm.state.trim(),
          pincode: vendorForm.pincode.trim()
        }
      };

      const res = await apiClient.post('/api/v1/vendors', payload);
      setInvitedVendorResult(res.data?.data);
      setActionSuccess(`Vendor invitation dispatched to ${vendorForm.email}.`);
      await loadVendors();
      setVendorForm({
        name: '',
        companyName: '',
        email: '',
        mobile: '',
        gstNumber: '',
        street: '',
        city: '',
        state: '',
        pincode: ''
      });
    } catch (err) {
      setVendorError(err.response?.data?.error?.message || err.message || 'Failed to invite vendor.');
    } finally {
      setSubmittingVendor(false);
    }
  };

  // Resend Vendor Invitation
  const handleResendVendorInvite = async (vendorId) => {
    try {
      setResendingVendorId(vendorId);
      await apiClient.post(`/api/v1/vendors/${vendorId}/onboarding/resend`);
      setActionSuccess('Vendor invitation link resent successfully.');
      await loadVendors();
    } catch (err) {
      setError(`Failed to resend invitation: ${err.message}`);
    } finally {
      setResendingVendorId(null);
    }
  };

  // Open Details Modal
  const openDetailsModal = async (tenant) => {
    setSelectedTenant(tenant);
    setDetailsModalOpen(true);
    setTenantDetails(null);
    try {
      setLoadingDetails(true);
      const res = await apiClient.get(`/api/v1/admin/tenants/${tenant.id}`);
      setTenantDetails(res.data?.data);
    } catch (err) {
      setError(`Could not fetch details for ${tenant.name}: ${err.message}`);
    } finally {
      setLoadingDetails(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-slate-800">
      
      {/* Platform Control Header Card */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-blue-400">
              <span>Ashvin Platform Foundation</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">Platform Scope</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight mt-1">
              Multi-Tenant Pharmacy Directory & Access Governance
            </h2>
            <p className="text-xs text-slate-300 mt-0.5 max-w-2xl">
              Super Admin authority to provision regional pharmacy tenants, configure isolation boundaries, govern operational lifecycle states, and issue cryptographically bound tenant administrator credentials.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setVendorError('');
                setInvitedVendorResult(null);
                setVendorModalOpen(true);
              }}
              className="bg-teal-600 hover:bg-teal-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 shadow-sm shrink-0"
            >
              <span>✉️</span>
              <span>Invite Vendor Partner</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setOnboardError('');
                setOnboardModalOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 shadow-sm shrink-0"
            >
              <span>➕</span>
              <span>Onboard Pharmacy Tenant</span>
            </button>
          </div>
        </div>

        {/* 4 Clean Metric Blocks */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-800 pt-2">
          <div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Total Tenants
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-slate-900">{totalCount}</span>
              <span className="text-[11px] font-semibold text-slate-500">registered</span>
            </div>
          </div>

          <div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Active Pharmacies
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-emerald-600">{activeCount}</span>
              <span className="text-[11px] font-semibold text-emerald-600">online</span>
            </div>
          </div>

          <div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Suspended
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-rose-600">{suspendedCount}</span>
              <span className="text-[11px] font-semibold text-rose-500">isolated</span>
            </div>
          </div>

          <div className="bg-white/95 rounded-2xl p-3.5 backdrop-blur-sm shadow-sm">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
              Pending Onboarding
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-amber-600">{pendingCount}</span>
              <span className="text-[11px] font-semibold text-amber-600">review</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications / Alerts */}
      {actionSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl p-3.5 flex items-center justify-between animate-fade-in shadow-sm">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <span className="font-semibold">{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess('')}
            className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 text-sm"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl p-3.5 flex items-center justify-between animate-fade-in shadow-sm">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-semibold">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError('')}
            className="text-rose-700 hover:text-rose-900 font-bold ml-2 text-sm"
          >
            ×
          </button>
        </div>
      )}

      {/* Main Tab Navigation between Tenants Directory & Vendor Onboarding Invitations */}
      <div className="flex border-b border-slate-200 gap-4">
        <button
          type="button"
          onClick={() => setPlatformTab('tenants')}
          className={`pb-3 text-xs font-black transition cursor-pointer flex items-center gap-2 border-b-2 ${
            platformTab === 'tenants'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🏢</span>
          <span>Tenants Directory ({totalCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setPlatformTab('vendors')}
          className={`pb-3 text-xs font-black transition cursor-pointer flex items-center gap-2 border-b-2 ${
            platformTab === 'vendors'
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>✉️</span>
          <span>Vendor Onboarding Invitations ({vendors.length})</span>
        </button>
      </div>

      {platformTab === 'tenants' ? (
        <>
          {/* Filter and Search Bar */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm">
        {/* Interactive Segmented Control Buttons (No static pills) */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-full sm:w-auto overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Tenants ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('ACTIVE')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'ACTIVE'
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('SUSPENDED')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'SUSPENDED'
                ? 'bg-white text-rose-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Suspended ({suspendedCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PENDING')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              statusFilter === 'PENDING'
                ? 'bg-white text-amber-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pending ({pendingCount})
          </button>
        </div>

        {/* Search input & Refresh */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              placeholder="Search by name, slug, code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1.5 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={loadTenants}
            disabled={loading}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer text-xs disabled:opacity-50 shrink-0"
            title="Reload Tenants"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Tenant Table / Cards Grid */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 space-y-2">
          <div className="inline-block animate-spin text-2xl">⚙️</div>
          <p className="text-xs font-bold">Querying platform tenant registry...</p>
        </div>
      ) : filteredTenants.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-500 space-y-3">
          <span className="text-3xl">🏢</span>
          <h4 className="text-sm font-bold text-slate-700">No matching tenants found</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery || statusFilter !== 'ALL'
              ? 'Try adjusting your search criteria or filter controls.'
              : 'Get started by onboarding your first regional pharmacy tenant to the platform.'}
          </p>
          <button
            type="button"
            onClick={() => setOnboardModalOpen(true)}
            className="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-blue-500 transition cursor-pointer"
          >
            Onboard New Tenant
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Pharmacy / Tenant</th>
                  <th className="py-3 px-4">System Identifiers</th>
                  <th className="py-3 px-4">Operating Status</th>
                  <th className="py-3 px-4">Contact Details</th>
                  <th className="py-3 px-4">Locale & Currency</th>
                  <th className="py-3 px-4 text-right">Administrative Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredTenants.map((t) => {
                  const isSuspended = t.status === 'SUSPENDED';
                  const isActive = t.status === 'ACTIVE';
                  const isPending = t.status === 'PENDING';
                  const isMutating = statusActionPending === t.id;

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Name & Legal */}
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900 text-sm">{t.name}</div>
                        <div className="text-[11px] text-slate-500">{t.legalName || t.name}</div>
                      </td>

                      {/* Identifiers */}
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div className="text-blue-600 font-semibold">{t.id}</div>
                        <div className="text-slate-400 text-[10px]">slug: {t.slug || '—'}</div>
                      </td>

                      {/* Status (Unboxed subtle typography with indicator dot, no pill candy) */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 font-bold">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isActive
                                ? 'bg-emerald-500'
                                : isSuspended
                                ? 'bg-rose-500'
                                : 'bg-amber-500'
                            }`}
                          />
                          <span
                            className={
                              isActive
                                ? 'text-emerald-700'
                                : isSuspended
                                ? 'text-rose-700'
                                : 'text-amber-700'
                            }
                          >
                            {t.status || 'ACTIVE'}
                          </span>
                        </div>
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4 text-[11px] text-slate-600">
                        <div>{t.contactEmail || t.email || '—'}</div>
                        <div className="text-slate-400">{t.contactPhone || t.phone || '—'}</div>
                      </td>

                      {/* Locale & Currency */}
                      <td className="py-3.5 px-4 text-[11px] text-slate-600">
                        <div className="flex items-center gap-1">
                          <span>{t.currency || 'INR'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-400">{t.timezone || 'Asia/Kolkata'}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Invite Admin Button */}
                          <button
                            type="button"
                            onClick={() => openInviteModal(t)}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer"
                            title="Invite a Tenant Administrator"
                          >
                            👤 Invite Admin
                          </button>

                          {/* Details / View */}
                          <button
                            type="button"
                            onClick={() => openDetailsModal(t)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer"
                            title="Inspect Tenant Details"
                          >
                            👁️ Details
                          </button>

                          {/* Suspend or Activate Toggle */}
                          {isActive && (
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => handleToggleStatus(t, 'suspend')}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50"
                              title="Suspend Tenant Operations"
                            >
                              {isMutating ? '...' : '🚫 Suspend'}
                            </button>
                          )}

                          {isSuspended && (
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => handleToggleStatus(t, 'activate')}
                              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50"
                              title="Re-activate Tenant"
                            >
                              {isMutating ? '...' : '✅ Activate'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  ) : (
        /* VENDOR ONBOARDING INVITATIONS VIEW */
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <h3 className="text-sm font-black text-slate-800">Pharmacy Vendor Onboarding Pipeline</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Issue single-use cryptographic invitation links. Vendors complete verification to automatically provision their Tenant workspaces.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setVendorError('');
                setInvitedVendorResult(null);
                setVendorModalOpen(true);
              }}
              className="bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <span>➕</span>
              <span>Invite New Vendor</span>
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Company & Vendor</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">GST / Tax ID</th>
                    <th className="py-3 px-4 text-center">Onboarding Status</th>
                    <th className="py-3 px-4">Timeline</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {vendors.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        {loadingVendors ? 'Loading vendor invitations...' : 'No vendor invitations issued yet. Click "Invite New Vendor" to get started.'}
                      </td>
                    </tr>
                  ) : (
                    vendors.map((v) => {
                      const vId = v._id || v.id;
                      const isCompleted = v.onboardingStatus === 'COMPLETED';
                      const isPending = v.onboardingStatus === 'PENDING' || v.status === 'INVITED';
                      return (
                        <tr key={vId} className="hover:bg-slate-50/70 transition">
                          <td className="py-3 px-4">
                            <div className="font-extrabold text-slate-900">{v.companyName || v.name}</div>
                            <div className="text-[11px] text-slate-500">{v.name}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800">{v.email}</div>
                            {v.mobile && <div className="text-[11px] text-slate-400">{v.mobile}</div>}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                            {v.gstNumber || '—'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                isCompleted
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : isPending
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {v.onboardingStatus || v.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[11px] text-slate-500">
                            <div>Invited: {v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—'}</div>
                            {isCompleted && v.onboardingCompletedAt && (
                              <div className="text-emerald-600 font-semibold">
                                Completed: {new Date(v.onboardingCompletedAt).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {!isCompleted ? (
                              <button
                                type="button"
                                disabled={resendingVendorId === vId}
                                onClick={() => handleResendVendorInvite(vId)}
                                className="px-2.5 py-1 text-xs font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition cursor-pointer disabled:opacity-50"
                              >
                                {resendingVendorId === vId ? 'Resending...' : 'Resend Invite'}
                              </button>
                            ) : (
                              <span className="text-[11px] font-bold text-emerald-600">Active Tenant</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: Onboard New Pharmacy Tenant                          */}
      {/* ============================================================== */}
      {onboardModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-scale-up border border-slate-100">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 block">
                  Platform Provisioning
                </span>
                <h3 className="text-lg font-black text-slate-900">
                  Onboard Regional Pharmacy Tenant
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOnboardModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {onboardError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium">
                {onboardError}
              </div>
            )}

            <form onSubmit={handleOnboardSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Pharmacy Brand Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apollo Life Care"
                  value={onboardForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const autoSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    setOnboardForm(prev => ({
                      ...prev,
                      name,
                      slug: prev.slug === '' || prev.slug === autoSlug.slice(0, -1) ? autoSlug : prev.slug
                    }));
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Unique Tenant Slug
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. apollo-life-care"
                    value={onboardForm.slug}
                    onChange={(e) => setOnboardForm(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Legal Entity Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Apollo Healthcare LLP"
                    value={onboardForm.legalName}
                    onChange={(e) => setOnboardForm(prev => ({ ...prev, legalName: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    placeholder="care@tenant.example.com"
                    value={onboardForm.contactEmail}
                    onChange={(e) => setOnboardForm(prev => ({ ...prev, contactEmail: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="+91 98260 12345"
                    value={onboardForm.contactPhone}
                    onChange={(e) => setOnboardForm(prev => ({ ...prev, contactPhone: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Initial Tenant Administrator Email (Optional)
                </label>
                <input
                  type="email"
                  placeholder="owner@tenant.example.com"
                  value={onboardForm.initialAdminEmail}
                  onChange={(e) => setOnboardForm(prev => ({ ...prev, initialAdminEmail: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  If provided, an invitation token and Tenant Admin membership will be provisioned immediately.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setOnboardModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 font-bold hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingOnboard}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold rounded-xl transition cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {submittingOnboard ? 'Provisioning...' : 'Provision Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: Invite Tenant Administrator                          */}
      {/* ============================================================== */}
      {inviteModalOpen && selectedTenant && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-up border border-slate-100">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 block">
                  Identity Delegation
                </span>
                <h3 className="text-lg font-black text-slate-900">
                  Invite Tenant Admin
                </h3>
                <p className="text-xs text-slate-500">
                  Target Tenant: <strong className="text-slate-800">{selectedTenant.name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {inviteError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium">
                {inviteError}
              </div>
            )}

            {issuedInvitation ? (
              <div className="space-y-3 bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-900 text-xs">
                <div className="flex items-center gap-1.5 font-extrabold text-sm text-emerald-800">
                  <span>✅</span>
                  <span>Invitation Successfully Issued</span>
                </div>
                <p className="text-[11px] text-emerald-700">
                  An administrator record has been registered for <strong>{issuedInvitation.email}</strong> under <strong>{selectedTenant.name}</strong>.
                </p>
                <div className="bg-white p-2.5 rounded-xl border border-emerald-200 font-mono text-[10px] break-all select-all text-slate-800">
                  Token: {issuedInvitation.invitationToken}
                </div>
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  className="w-full bg-emerald-600 text-white font-extrabold py-2 rounded-xl text-xs hover:bg-emerald-500 transition cursor-pointer"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Administrator Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. manager@pharmacy.in"
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Full Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={inviteForm.name}
                    onChange={(e) => setInviteForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 space-y-1">
                  <div className="font-bold text-slate-700">Security Guarantee:</div>
                  <p>
                    Invited administrators receive <strong>TENANT_ADMIN</strong> scope bound exclusively to this tenant. Cross-tenant access is strictly denied by the API Gateway.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 font-bold hover:bg-slate-50 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingInvite}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold rounded-xl transition cursor-pointer disabled:opacity-50 shadow-sm"
                  >
                    {submittingInvite ? 'Issuing...' : 'Issue Invitation'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: Detailed Tenant Information & Memberships            */}
      {/* ============================================================== */}
      {detailsModalOpen && selectedTenant && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-scale-up border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 block">
                  Tenant Diagnostics & Memberships
                </span>
                <h3 className="text-lg font-black text-slate-900">
                  {selectedTenant.name}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  ID: {selectedTenant.id} · Slug: {selectedTenant.slug}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {loadingDetails ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                Loading tenant diagnostics...
              </div>
            ) : tenantDetails ? (
              <div className="space-y-4 text-xs">
                {/* Branches Section */}
                <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-extrabold text-slate-800">
                      Dispensary Branches ({tenantDetails.branches?.length || 0})
                    </span>
                  </div>
                  {tenantDetails.branches && tenantDetails.branches.length > 0 ? (
                    <div className="space-y-2">
                      {tenantDetails.branches.map(b => (
                        <div key={b.id} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                          <div>
                            <div className="font-bold text-slate-900">{b.name}</div>
                            <div className="text-[11px] text-slate-500">
                              {b.address?.street}, {b.address?.city} ({b.address?.pincode})
                            </div>
                          </div>
                          <div className="text-right text-[11px] text-slate-600 font-mono">
                            <div>Radius: {b.serviceRadiusKm} km</div>
                            <div className="text-slate-400">Min: ₹{b.minimumOrderValue}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-[11px] italic">No physical branches registered yet.</p>
                  )}
                </div>

                {/* Memberships Section */}
                <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-2">
                  <span className="font-extrabold text-slate-800 block">
                    Administrative Staff & Delegated Memberships ({tenantDetails.memberships?.length || 0})
                  </span>
                  {tenantDetails.memberships && tenantDetails.memberships.length > 0 ? (
                    <div className="space-y-2">
                      {tenantDetails.memberships.map((m, idx) => (
                        <div key={m.id || idx} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                          <div>
                            <div className="font-bold text-slate-900">{m.email || m.userId}</div>
                            <div className="text-[11px] text-blue-600 font-semibold">{m.role}</div>
                          </div>
                          <div className="text-right text-[11px]">
                            <span className={`font-bold ${m.status === 'ACTIVE' ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {m.status}
                            </span>
                            {m.invitationToken && (
                              <div className="text-[10px] text-slate-400 font-mono">Token: {m.invitationToken.slice(0, 12)}...</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-[11px] italic">No active memberships attached.</p>
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDetailsModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Invite Vendor Partner Modal */}
      {vendorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col my-auto overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100 shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">✉️</span>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900">
                    Invite Pharmacy Vendor Partner
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Dispatches a cryptographically secure, single-use onboarding token to the vendor.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVendorModalOpen(false);
                  setInvitedVendorResult(null);
                  setVendorError('');
                }}
                className="text-slate-400 hover:text-slate-600 w-8 h-8 rounded-full flex items-center justify-center bg-slate-50 hover:bg-slate-100 transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {vendorError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{vendorError}</span>
                </div>
              )}

              {invitedVendorResult ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🎉</span>
                      <h4 className="font-black text-sm">Vendor Partner Invited Successfully!</h4>
                    </div>
                    <p className="text-xs text-emerald-800">
                      An onboarding link has been generated. The vendor can complete their registration, setup pharmacy branches, and claim their tenant portal.
                    </p>
                    <div className="pt-2 text-xs space-y-1 text-slate-700">
                      <p><span className="font-bold">Vendor Name:</span> {invitedVendorResult.name}</p>
                      <p><span className="font-bold">Email:</span> {invitedVendorResult.email}</p>
                      <p><span className="font-bold">Status:</span> <span className="font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full text-[10px]">{invitedVendorResult.status || 'INVITED'}</span></p>
                      {invitedVendorResult.onboardingUrl && (
                        <div className="mt-3 p-3 bg-white border border-emerald-300 rounded-xl space-y-2">
                          <label className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">
                            Direct Onboarding Link
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={invitedVendorResult.onboardingUrl}
                              className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-2 w-full select-all"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(invitedVendorResult.onboardingUrl);
                                setActionSuccess('Onboarding link copied to clipboard!');
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-2 rounded-lg shrink-0 cursor-pointer"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setInvitedVendorResult(null);
                        setVendorModalOpen(false);
                      }}
                      className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleVendorSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-500 block tracking-wider mb-1">
                        Vendor Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Ramesh Patel"
                        value={vendorForm.name}
                        onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                        className="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-500 block tracking-wider mb-1">
                        Company / Pharmacy Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Patel Healthcare LLC"
                        value={vendorForm.companyName}
                        onChange={(e) => setVendorForm({ ...vendorForm, companyName: e.target.value })}
                        className="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-500 block tracking-wider mb-1">
                        Vendor Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        placeholder="vendor@pharmacy.example.com"
                        value={vendorForm.email}
                        onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                        className="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-500 block tracking-wider mb-1">
                        Mobile Phone Number
                      </label>
                      <input
                        type="tel"
                        placeholder="+91 98765 43210"
                        value={vendorForm.mobile}
                        onChange={(e) => setVendorForm({ ...vendorForm, mobile: e.target.value })}
                        className="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 block tracking-wider mb-1">
                      GSTIN / Tax Registration Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 23AAAAA0000A1Z5"
                      value={vendorForm.gstNumber}
                      onChange={(e) => setVendorForm({ ...vendorForm, gstNumber: e.target.value })}
                      className="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden font-mono uppercase"
                    />
                  </div>

                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <span className="text-[10px] font-black uppercase text-slate-400 block tracking-wider">
                      Registered Address (Optional)
                    </span>
                    <input
                      type="text"
                      placeholder="Street address or landmark"
                      value={vendorForm.street}
                      onChange={(e) => setVendorForm({ ...vendorForm, street: e.target.value })}
                      className="w-full text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="City"
                        value={vendorForm.city}
                        onChange={(e) => setVendorForm({ ...vendorForm, city: e.target.value })}
                        className="text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                      />
                      <input
                        type="text"
                        placeholder="State"
                        value={vendorForm.state}
                        onChange={(e) => setVendorForm({ ...vendorForm, state: e.target.value })}
                        className="text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                      />
                      <input
                        type="text"
                        placeholder="Pincode"
                        value={vendorForm.pincode}
                        onChange={(e) => setVendorForm({ ...vendorForm, pincode: e.target.value })}
                        className="text-xs border border-slate-200 rounded-xl p-2.5 focus:border-blue-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setVendorModalOpen(false)}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingVendor}
                      className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                    >
                      <span>{submittingVendor ? 'Generating Invitation...' : 'Dispatch Invitation'}</span>
                      <span>✉️</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
