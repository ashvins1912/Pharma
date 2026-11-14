import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';

const TIER_STYLES = {
  Admin: 'bg-blue-50 text-blue-700 border-blue-200',
  Staff: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Customer: 'bg-slate-100 text-slate-700 border-slate-200'
};

const OUTCOME_STYLES = {
  ALLOWED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DENIED: 'bg-rose-50 text-rose-700 border-rose-200',
  FAILED: 'bg-amber-50 text-amber-800 border-amber-200'
};

function formatFeatureTitle(feature) {
  return String(feature || '')
    .split(/[_.-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDiffSummary(before, after) {
  if (!before && !after) return null;
  const parts = [];
  if (before?.role !== undefined || after?.role !== undefined) {
    if (before?.role !== after?.role) {
      parts.push(`Role: ${before?.role || '—'} → ${after?.role || '—'}`);
    }
  }
  if (Array.isArray(before?.permissions) || Array.isArray(after?.permissions)) {
    const prevSet = new Set(before?.permissions || []);
    const nextSet = new Set(after?.permissions || []);
    const added = [...nextSet].filter(p => !prevSet.has(p));
    const removed = [...prevSet].filter(p => !nextSet.has(p));
    if (added.length) parts.push(`+${added.length} perm${added.length === 1 ? '' : 's'} (${added.slice(0, 3).join(', ')}${added.length > 3 ? '…' : ''})`);
    if (removed.length) parts.push(`-${removed.length} perm${removed.length === 1 ? '' : 's'} (${removed.slice(0, 3).join(', ')}${removed.length > 3 ? '…' : ''})`);
  }
  if (Array.isArray(before?.accessGrants) || Array.isArray(after?.accessGrants)) {
    const prevG = (before?.accessGrants || []).join(',');
    const nextG = (after?.accessGrants || []).join(',');
    if (prevG !== nextG) {
      parts.push(`Grants: ${after?.accessGrants?.length || 0}`);
    }
  }
  if (Array.isArray(before?.accessRevokes) || Array.isArray(after?.accessRevokes)) {
    const prevR = (before?.accessRevokes || []).join(',');
    const nextR = (after?.accessRevokes || []).join(',');
    if (prevR !== nextR) {
      parts.push(`Revokes: ${after?.accessRevokes?.length || 0}`);
    }
  }
  if (after?.policyDigest && after.policyDigest !== before?.policyDigest) {
    parts.push(`Digest ${String(after.policyDigest).slice(0, 10)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

export default function RbacAccessGovernanceTab() {
  const { user: currentUser, isSuperAdmin, hasPermission } = useAuth();
  const canModify = isSuperAdmin || hasPermission('users.manage');

  const [subTab, setSubTab] = useState('roles');
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [saving, setSaving] = useState(false);

  const [statusBanner, setStatusBanner] = useState(null);

  // Governance Roles State
  const [canonicalTiers, setCanonicalTiers] = useState([]);
  const [systemRoles, setSystemRoles] = useState([]);
  const [availablePermissions, setAvailablePermissions] = useState([]);
  const [selectedRoleCode, setSelectedRoleCode] = useState('TENANT_ADMIN');
  const [draftRolePerms, setDraftRolePerms] = useState([]);
  const [rolePermFilter, setRolePermFilter] = useState('');
  const [roleReason, setRoleReason] = useState('');

  // Directory Users & Role Assignment State
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [userTierFilter, setUserTierFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState(null);
  const [targetRole, setTargetRole] = useState('');
  const [userGrants, setUserGrants] = useState([]);
  const [userRevokes, setUserRevokes] = useState([]);
  const [userPermFilter, setUserPermFilter] = useState('');
  const [assignReason, setAssignReason] = useState('');

  // Activity Logs State
  const [activityLogs, setActivityLogs] = useState([]);
  const [logOutcomeFilter, setLogOutcomeFilter] = useState('');
  const [logActionFilter, setLogActionFilter] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [logLimit, setLogLimit] = useState(60);

  const fetchRoles = useCallback(async () => {
    setLoadingRoles(true);
    try {
      const res = await apiClient.get('/api/v1/admin/rbac/governance/roles');
      const data = res.data?.data || {};
      const nextSystemRoles = Array.isArray(data.systemRoles) ? data.systemRoles : [];
      setCanonicalTiers(Array.isArray(data.canonicalTiers) ? data.canonicalTiers : []);
      setSystemRoles(nextSystemRoles);
      setAvailablePermissions(Array.isArray(data.availablePermissions) ? data.availablePermissions : []);

      setSelectedRoleCode(prev => {
        const stillExists = nextSystemRoles.some(r => r.code === prev);
        if (stillExists) return prev;
        return nextSystemRoles[0]?.code || 'TENANT_ADMIN';
      });
    } catch (err) {
      setStatusBanner({ type: 'error', text: err.message || 'Unable to load centralized RBAC role policies.' });
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await apiClient.get('/api/v1/admin/rbac/governance/users', {
        params: {
          search: userSearch.trim() || undefined,
          tier: userTierFilter !== 'ALL' ? userTierFilter : undefined
        }
      });
      const list = Array.isArray(res.data?.data?.users) ? res.data.data.users : [];
      setUsers(list);
      setSelectedUser(prev => {
        if (!prev) return list[0] || null;
        return list.find(item => item.id === prev.id) || list[0] || null;
      });
    } catch (err) {
      setStatusBanner({ type: 'error', text: err.message || 'Unable to load user directory.' });
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [userSearch, userTierFilter]);

  const fetchActivityLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await apiClient.get('/api/v1/admin/rbac/governance/activity-logs', {
        params: {
          limit: logLimit,
          outcome: logOutcomeFilter || undefined,
          action: logActionFilter || undefined,
          search: logSearch.trim() || undefined
        }
      });
      const list = Array.isArray(res.data?.data?.logs) ? res.data.data.logs : [];
      setActivityLogs(list);
    } catch (err) {
      setStatusBanner({ type: 'error', text: err.message || 'Unable to load sensitive activity logs.' });
    } finally {
      setLoadingLogs(false);
    }
  }, [logLimit, logOutcomeFilter, logActionFilter, logSearch]);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchUsers(); }, 200);
    return () => window.clearTimeout(timer);
  }, [fetchUsers]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchActivityLogs(); }, 200);
    return () => window.clearTimeout(timer);
  }, [fetchActivityLogs]);

  const activeSystemRole = useMemo(
    () => systemRoles.find(r => r.code === selectedRoleCode) || null,
    [systemRoles, selectedRoleCode]
  );

  useEffect(() => {
    if (activeSystemRole) {
      setDraftRolePerms([...(activeSystemRole.permissions || [])]);
      setRoleReason('');
    }
  }, [activeSystemRole]);

  useEffect(() => {
    if (selectedUser) {
      setTargetRole(selectedUser.role || 'CUSTOMER');
      setUserGrants([...(selectedUser.accessGrants || [])]);
      setUserRevokes([...(selectedUser.accessRevokes || [])]);
      setAssignReason('');
    }
  }, [selectedUser]);

  const groupedPermissions = useMemo(() => {
    const groups = new Map();
    for (const perm of availablePermissions) {
      const [feature] = String(perm).split('.');
      if (!groups.has(feature)) groups.set(feature, []);
      groups.get(feature).push(perm);
    }
    return [...groups.entries()].map(([feature, perms]) => ({
      feature,
      title: formatFeatureTitle(feature),
      permissions: perms
    }));
  }, [availablePermissions]);

  const filteredRoleGroups = useMemo(() => {
    const q = rolePermFilter.trim().toLowerCase();
    if (!q) return groupedPermissions;
    return groupedPermissions
      .map(g => ({
        ...g,
        permissions: g.permissions.filter(p => p.toLowerCase().includes(q) || g.title.toLowerCase().includes(q))
      }))
      .filter(g => g.permissions.length > 0);
  }, [groupedPermissions, rolePermFilter]);

  const filteredUserPerms = useMemo(() => {
    const q = userPermFilter.trim().toLowerCase();
    const list = availablePermissions.filter(p => !p.includes('*'));
    if (!q) return list;
    return list.filter(p => p.toLowerCase().includes(q));
  }, [availablePermissions, userPermFilter]);

  const assignableRoles = useMemo(() => {
    if (isSuperAdmin) return systemRoles;
    return systemRoles.filter(r => !r.isProtected);
  }, [systemRoles, isSuperAdmin]);

  const toggleRolePermission = (perm) => {
    if (!canModify || activeSystemRole?.isProtected) return;
    setDraftRolePerms(prev => (
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    ));
  };

  const toggleFeatureGroup = (perms, shouldEnable) => {
    if (!canModify || activeSystemRole?.isProtected) return;
    setDraftRolePerms(prev => {
      const set = new Set(prev);
      for (const perm of perms) {
        if (shouldEnable) set.add(perm);
        else set.delete(perm);
      }
      return [...set];
    });
  };

  const handleSaveRolePermissions = async (e) => {
    e.preventDefault();
    if (!activeSystemRole || !canModify || activeSystemRole.isProtected || saving) return;
    if (roleReason.trim().length < 3) {
      setStatusBanner({ type: 'error', text: 'Enter an audit reason (at least 3 characters) before saving role permissions.' });
      return;
    }

    setSaving(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.put(`/api/v1/admin/rbac/governance/roles/${encodeURIComponent(activeSystemRole.code)}/permissions`, {
        permissions: draftRolePerms,
        reason: roleReason.trim()
      });
      setStatusBanner({
        type: 'success',
        text: res.data?.message || `Updated permissions for ${activeSystemRole.code}.`
      });
      setRoleReason('');
      await Promise.all([fetchRoles(), fetchActivityLogs()]);
    } catch (err) {
      setStatusBanner({ type: 'error', text: err.message || 'Could not update role permissions.' });
      void fetchActivityLogs();
    } finally {
      setSaving(false);
    }
  };

  const setUserPermissionOverride = (perm, mode) => {
    if (!canModify) return;
    if (mode === 'grant') {
      setUserRevokes(prev => prev.filter(p => p !== perm));
      setUserGrants(prev => (prev.includes(perm) ? prev : [...prev, perm]));
    } else if (mode === 'revoke') {
      setUserGrants(prev => prev.filter(p => p !== perm));
      setUserRevokes(prev => (prev.includes(perm) ? prev : [...prev, perm]));
    } else {
      setUserGrants(prev => prev.filter(p => p !== perm));
      setUserRevokes(prev => prev.filter(p => p !== perm));
    }
  };

  const handleAssignUserRole = async (e) => {
    e.preventDefault();
    if (!selectedUser || !canModify || saving) return;
    if (assignReason.trim().length < 3) {
      setStatusBanner({ type: 'error', text: 'Enter an audit reason (at least 3 characters) before updating user roles or overrides.' });
      return;
    }

    setSaving(true);
    setStatusBanner(null);
    try {
      const res = await apiClient.patch(`/api/v1/admin/rbac/governance/users/${encodeURIComponent(selectedUser.id)}/role`, {
        role: targetRole,
        grants: userGrants,
        revokes: userRevokes,
        reason: assignReason.trim()
      });
      const updatedUser = res.data?.data?.user;
      if (updatedUser) {
        setSelectedUser(updatedUser);
        setUsers(prev => prev.map(u => (u.id === updatedUser.id ? updatedUser : u)));
      }
      setStatusBanner({
        type: 'success',
        text: res.data?.message || `Role assignment updated for ${selectedUser.email || selectedUser.id}.`
      });
      setAssignReason('');
      await Promise.all([fetchUsers(), fetchActivityLogs()]);
    } catch (err) {
      setStatusBanner({ type: 'error', text: err.message || 'Could not update user role assignment.' });
      void fetchActivityLogs();
    } finally {
      setSaving(false);
    }
  };

  const deniedCount = useMemo(
    () => activityLogs.filter(item => item.outcome === 'DENIED' || item.outcome === 'FAILED').length,
    [activityLogs]
  );

  const isViewingSelf = Boolean(
    selectedUser &&
    currentUser &&
    (selectedUser.id === currentUser.id || selectedUser.id === currentUser.sub || selectedUser.email === currentUser.email)
  );

  const selectedRoleChanged = Boolean(
    activeSystemRole && (
      draftRolePerms.length !== (activeSystemRole.permissions || []).length ||
      draftRolePerms.some(p => !(activeSystemRole.permissions || []).includes(p))
    )
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      {/* Light-Mode Header */}
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-5 sm:px-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
              <span className="font-bold uppercase tracking-wider text-blue-700">Centralized RBAC Service</span>
              <span aria-hidden="true">·</span>
              <span>Display &amp; Modify Enforcement</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-700">
                {canModify ? 'Read / Modify Authorized' : 'Read-Only Display Mode'}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
              Roles, User Assignments &amp; Sensitive Activity
            </h2>
            <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
              Manage canonical Admin, Staff, and Customer access policies, assign roles and permission overrides to users, and audit sensitive authorization events.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => { void Promise.all([fetchRoles(), fetchUsers(), fetchActivityLogs()]); }}
              className="min-h-11 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-900 text-xs font-bold px-4 py-2 transition whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <span>Refresh All</span>
            </button>
          </div>
        </div>

        {/* Summary Metrics Strip */}
        <div className="mt-5 flex flex-col sm:flex-row sm:flex-wrap gap-3">
          <div className="flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">Canonical Tiers</span>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-black text-slate-900 tabular-nums">{canonicalTiers.length || 3}</span>
              <span className="text-xs text-slate-600 font-medium">Admin · Staff · Customer</span>
            </div>
          </div>

          <div className="flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">System Role Policies</span>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-black text-blue-700 tabular-nums">{systemRoles.length}</span>
              <span className="text-xs text-slate-600 font-medium tabular-nums">{availablePermissions.length} permissions</span>
            </div>
          </div>

          <div className="flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">Directory Users</span>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-black text-slate-900 tabular-nums">{users.length}</span>
              <span className="text-xs text-slate-600 font-medium">Filter: {userTierFilter}</span>
            </div>
          </div>

          <div className="flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">Sensitive Audit Events</span>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-black text-emerald-700 tabular-nums">{activityLogs.length}</span>
              <span className={`text-xs font-semibold tabular-nums ${deniedCount > 0 ? 'text-rose-700' : 'text-slate-600'}`}>
                {deniedCount} denied / failed
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Sub-navigation tabs */}
      <div className="border-b border-slate-200 bg-slate-50 px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="RBAC governance views">
          {[
            { id: 'roles', label: 'Roles & Permissions', count: systemRoles.length },
            { id: 'users', label: 'Assign User Roles', count: users.length },
            { id: 'logs', label: 'Sensitive Activity Logs', count: activityLogs.length }
          ].map(tab => {
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setSubTab(tab.id); setStatusBanner(null); }}
                className={`min-h-11 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap shrink-0 cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                  active
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-xs font-mono tabular-nums ${active ? 'text-blue-100' : 'text-slate-600'}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <span className="text-xs text-slate-600 font-medium">
          Operations enforced via centralized <code className="font-mono font-semibold text-slate-900">display</code> / <code className="font-mono font-semibold text-slate-900">modify</code> middleware
        </span>
      </div>

      {/* Status feedback banner */}
      {statusBanner && (
        <div
          role="status"
          className={`mx-4 sm:mx-6 mt-4 rounded-xl border px-4 py-3 text-xs font-semibold flex items-center justify-between gap-3 ${
            statusBanner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-xs font-bold hover:bg-white/60 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Dismiss notification"
          >
            <span>✕</span>
          </button>
        </div>
      )}

      {/* TAB 1: ROLES & PERMISSIONS */}
      {subTab === 'roles' && (
        <div className="p-4 sm:p-6 space-y-5">
          {/* Canonical 3-Tier Overview */}
          <div className="flex flex-col md:flex-row gap-4">
            {canonicalTiers.map(tier => (
              <div
                key={tier.tier}
                className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col justify-between gap-2.5"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-bold ${TIER_STYLES[tier.tier] || TIER_STYLES.Customer}`}>
                      {tier.label}
                    </span>
                    <span className="text-xs font-mono text-slate-600">
                      Ops: {(tier.allowedOperations || []).join(' · ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {tier.description}
                  </p>
                </div>
                <div className="text-xs text-slate-600 pt-2 border-t border-slate-200 truncate" title={(tier.mappedSystemRoles || []).join(', ')}>
                  <span>Mapped: {(tier.mappedSystemRoles || []).join(', ')}</span>
                </div>
              </div>
            ))}
          </div>

          {/* System Role Matrix & Editor */}
          <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:items-start">
            {/* System Role Selector */}
            <aside className="w-full lg:w-72 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-1.5">
              <span className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {loadingRoles ? 'Loading roles…' : `${systemRoles.length} System Roles`}
              </span>
              {systemRoles.map(roleItem => {
                const isActive = roleItem.code === selectedRoleCode;
                return (
                  <button
                    key={roleItem.code}
                    type="button"
                    onClick={() => { setSelectedRoleCode(roleItem.code); setStatusBanner(null); }}
                    className={`min-h-11 w-full text-left rounded-xl border p-3 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isActive
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-slate-200/80 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-slate-900 truncate">{roleItem.code}</span>
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold shrink-0 ${TIER_STYLES[roleItem.canonicalTier] || TIER_STYLES.Customer}`}>
                        {roleItem.canonicalTier}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
                      <span>Scope: {roleItem.scope}</span>
                      <span className="font-mono tabular-nums">
                        {roleItem.isProtected ? 'Full (*) · Locked' : `${roleItem.permissions?.length || 0} perms`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </aside>

            {/* Permission Policy Form */}
            {activeSystemRole ? (
              <form onSubmit={handleSaveRolePermissions} className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-slate-900">{activeSystemRole.code}</h3>
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${TIER_STYLES[activeSystemRole.canonicalTier] || TIER_STYLES.Customer}`}>
                        {activeSystemRole.canonicalTier} Tier
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      Scope: {activeSystemRole.scope} · Operations: {(activeSystemRole.allowedOperations || []).join(', ')} ·{' '}
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">{draftRolePerms.length}</span> permission{draftRolePerms.length === 1 ? '' : 's'} selected
                    </p>
                  </div>

                  <input
                    type="search"
                    value={rolePermFilter}
                    onChange={e => setRolePermFilter(e.target.value)}
                    placeholder="Filter permissions…"
                    aria-label="Filter role permissions"
                    className="min-h-11 w-full sm:w-56 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                {activeSystemRole.isProtected && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs font-medium text-amber-900">
                    <span>
                      Platform root role <code className="font-mono font-bold">{activeSystemRole.code}</code> retains immutable wildcard (<code className="font-mono">*</code>) privileges and cannot be downgraded from the UI.
                    </span>
                  </div>
                )}

                <div className="flex flex-col md:flex-row md:flex-wrap gap-3.5 max-h-[460px] overflow-y-auto pr-1">
                  {filteredRoleGroups.map(group => {
                    const selectedInGroup = group.permissions.filter(p => draftRolePerms.includes(p)).length;
                    const allSelected = selectedInGroup === group.permissions.length;
                    return (
                      <div key={group.feature} className="w-full md:w-[calc(50%-0.5rem)] rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-extrabold text-slate-900">{group.title}</h4>
                            <span className="text-[11px] font-mono text-slate-600 tabular-nums">
                              {selectedInGroup}/{group.permissions.length} active
                            </span>
                          </div>
                          {canModify && !activeSystemRole.isProtected && (
                            <button
                              type="button"
                              onClick={() => toggleFeatureGroup(group.permissions, !allSelected)}
                              className="min-h-9 px-2.5 rounded-lg text-xs font-bold text-blue-700 hover:bg-blue-50 hover:underline cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              <span>{allSelected ? 'Clear all' : 'Select all'}</span>
                            </button>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          {group.permissions.map(perm => {
                            const checked = activeSystemRole.isProtected || draftRolePerms.includes(perm);
                            return (
                              <label
                                key={perm}
                                className={`min-h-10 flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                                  checked
                                    ? 'border-blue-200 bg-white text-slate-900 font-semibold'
                                    : 'border-slate-200 bg-white/60 text-slate-700'
                                } ${canModify && !activeSystemRole.isProtected ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                <span className="font-mono text-[11px] truncate">{perm}</span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!canModify || activeSystemRole.isProtected}
                                  onChange={() => toggleRolePermission(perm)}
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 shrink-0"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {canModify && !activeSystemRole.isProtected && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 border-t border-slate-200 pt-4">
                    <input
                      type="text"
                      value={roleReason}
                      onChange={e => setRoleReason(e.target.value)}
                      placeholder="Audit reason (required, e.g. Grant pharmacist batch verification rights)"
                      minLength={3}
                      maxLength={240}
                      aria-label="Audit reason for role permission update"
                      className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="submit"
                      disabled={saving || !selectedRoleChanged}
                      className="min-h-11 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-5 py-2.5 transition whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                    >
                      <span>{saving ? 'Saving Policy…' : 'Save Role Permissions'}</span>
                    </button>
                  </div>
                )}
              </form>
            ) : (
              <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-600">
                <span>Select a system role to inspect or update its permissions.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ASSIGN USER ROLES */}
      {subTab === 'users' && (
        <div className="p-4 sm:p-6 space-y-4">
          {/* Search & Tier Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <input
              type="search"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search users by name, email, role, or user ID…"
              aria-label="Search platform users"
              className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter users by tier">
              {['ALL', 'Admin', 'Staff', 'Customer'].map(tier => {
                const active = userTierFilter === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setUserTierFilter(tier)}
                    className={`min-h-11 rounded-xl border px-3.5 py-2 text-xs font-bold transition whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      active
                        ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{tier === 'ALL' ? 'All Tiers' : tier}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-5 items-stretch lg:items-start">
            {/* Users Directory */}
            <aside className="w-full lg:w-80 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-1.5 max-h-[560px] overflow-y-auto">
              <span className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {loadingUsers ? 'Searching users…' : `${users.length} Matching Users`}
              </span>
              {!loadingUsers && users.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-600">
                  <span>No users found for the active filter.</span>
                </div>
              ) : (
                users.map(u => {
                  const isActive = selectedUser?.id === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => { setSelectedUser(u); setStatusBanner(null); }}
                      className={`min-h-11 w-full text-left rounded-xl border p-3 transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        isActive
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-200/80 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block text-xs font-extrabold text-slate-900 truncate">{u.name}</span>
                          <span className="block text-xs text-slate-600 truncate">{u.email || u.id}</span>
                        </div>
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold shrink-0 ${TIER_STYLES[u.canonicalTier] || TIER_STYLES.Customer}`}>
                          {u.canonicalTier}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                        <span className="font-mono font-semibold text-slate-800">{u.role}</span>
                        <span className="font-mono tabular-nums">
                          v{u.permissionVersion || 1}
                          {(u.accessGrants?.length || u.accessRevokes?.length)
                            ? ` · +${u.accessGrants?.length || 0}/-${u.accessRevokes?.length || 0}`
                            : ''}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </aside>

            {/* User Role & Override Form */}
            {selectedUser ? (
              <form onSubmit={handleAssignUserRole} className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-black text-slate-900 truncate">{selectedUser.name}</h3>
                      <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${TIER_STYLES[selectedUser.canonicalTier] || TIER_STYLES.Customer}`}>
                        {selectedUser.canonicalTier}
                      </span>
                      {isViewingSelf && (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                          Current Session
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-600 truncate">
                      {selectedUser.email || 'No email'} · ID: <code className="font-mono text-slate-800">{selectedUser.id}</code>
                      {selectedUser.tenantId ? ` · Tenant: ${selectedUser.tenantId}` : ''}
                      {` · Policy v${selectedUser.permissionVersion || 1}`}
                    </p>
                  </div>
                </div>

                {isViewingSelf && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs font-medium text-amber-900">
                    <span>
                      Self-modification safeguard: you cannot reassign your own administrative role. Select another user to apply role changes.
                    </span>
                  </div>
                )}

                {/* Canonical Quick Select + Exact Role Select */}
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 space-y-2">
                    <span className="block text-xs font-bold text-slate-700">
                      Quick Canonical Role Assignment
                    </span>
                    <div className="flex flex-row gap-2">
                      {canonicalTiers.map(tier => {
                        const defaultCode = tier.defaultAssignableRole || tier.tier;
                        const active = targetRole === defaultCode ||
                          (tier.mappedSystemRoles || []).includes(targetRole);
                        return (
                          <button
                            key={tier.tier}
                            type="button"
                            disabled={!canModify || isViewingSelf}
                            onClick={() => setTargetRole(defaultCode)}
                            className={`min-h-11 flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                              active
                                ? 'border-blue-600 bg-blue-50 text-blue-800'
                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span>{tier.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex-1 space-y-2">
                    <label htmlFor="assign-system-role" className="block text-xs font-bold text-slate-700">
                      Assigned System Role
                    </label>
                    <select
                      id="assign-system-role"
                      value={targetRole}
                      disabled={!canModify || isViewingSelf}
                      onChange={e => setTargetRole(e.target.value)}
                      className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
                    >
                      {assignableRoles.map(r => (
                        <option key={r.code} value={r.code}>
                          {r.code} ({r.canonicalTier} · {r.scope})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Per-user Permission Grants / Revokes */}
                <div className="space-y-3 border-t border-slate-200 pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-extrabold text-slate-900">
                        User-Specific Permission Overrides
                      </h4>
                      <p className="text-xs text-slate-600">
                        Grants: <strong className="tabular-nums text-slate-900">{userGrants.length}</strong> · Revokes: <strong className="tabular-nums text-slate-900">{userRevokes.length}</strong> (Explicit revokes always take precedence)
                      </p>
                    </div>
                    <input
                      type="search"
                      value={userPermFilter}
                      onChange={e => setUserPermFilter(e.target.value)}
                      placeholder="Filter permissions…"
                      aria-label="Filter user permission overrides"
                      className="min-h-11 w-full sm:w-56 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-200">
                    {filteredUserPerms.map(perm => {
                      const mode = userGrants.includes(perm)
                        ? 'grant'
                        : userRevokes.includes(perm)
                          ? 'revoke'
                          : 'inherit';
                      return (
                        <div key={perm} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2.5 text-xs">
                          <span className="font-mono text-xs text-slate-800 truncate">{perm}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {[
                              { id: 'inherit', label: 'Default' },
                              { id: 'grant', label: 'Grant' },
                              { id: 'revoke', label: 'Revoke' }
                            ].map(option => (
                              <button
                                key={option.id}
                                type="button"
                                disabled={!canModify || isViewingSelf}
                                onClick={() => setUserPermissionOverride(perm, option.id)}
                                className={`min-h-9 rounded-lg border px-2.5 py-1 text-xs font-bold transition cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                                  mode === option.id
                                    ? option.id === 'grant'
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                      : option.id === 'revoke'
                                        ? 'border-rose-300 bg-rose-50 text-rose-800'
                                        : 'border-blue-300 bg-blue-50 text-blue-800'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                <span>{option.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {canModify && !isViewingSelf && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 border-t border-slate-200 pt-4">
                    <input
                      type="text"
                      value={assignReason}
                      onChange={e => setAssignReason(e.target.value)}
                      placeholder="Audit reason (required, e.g. Promote user to Pharmacy Staff)"
                      minLength={3}
                      maxLength={240}
                      aria-label="Audit reason for user role assignment"
                      className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="submit"
                      disabled={saving}
                      className="min-h-11 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-5 py-2.5 transition whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                    >
                      <span>{saving ? 'Applying Assignment…' : 'Apply Role Assignment'}</span>
                    </button>
                  </div>
                )}
              </form>
            ) : (
              <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-600">
                <span>Select a user from the directory to view or assign roles and permission overrides.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SENSITIVE ACTIVITY LOGS */}
      {subTab === 'logs' && (
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
            <input
              type="search"
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
              placeholder="Search actor, target, action, or reason…"
              aria-label="Search activity logs"
              className="min-h-11 flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <select
              value={logOutcomeFilter}
              onChange={e => setLogOutcomeFilter(e.target.value)}
              aria-label="Filter logs by outcome"
              className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">All Outcomes</option>
              <option value="ALLOWED">ALLOWED</option>
              <option value="DENIED">DENIED</option>
              <option value="FAILED">FAILED</option>
            </select>
            <select
              value={logActionFilter}
              onChange={e => setLogActionFilter(e.target.value)}
              aria-label="Filter logs by action"
              className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">All Actions</option>
              <option value="ROLE_ASSIGNED">ROLE_ASSIGNED</option>
              <option value="USER_PERMISSIONS_UPDATED">USER_PERMISSIONS_UPDATED</option>
              <option value="ROLE_PERMISSIONS_UPDATED">ROLE_PERMISSIONS_UPDATED</option>
              <option value="DISPLAY_ACCESS_DENIED">DISPLAY_ACCESS_DENIED</option>
              <option value="MODIFY_ACCESS_DENIED">MODIFY_ACCESS_DENIED</option>
              <option value="ROLE_ASSIGNMENT_FAILED">ROLE_ASSIGNMENT_FAILED</option>
              <option value="CODE_RBAC_MODIFIED">CODE_RBAC_MODIFIED</option>
              <option value="CODE_RBAC_REDEPLOYED">CODE_RBAC_REDEPLOYED</option>
              <option value="CODE_RBAC_ROLLED_BACK">CODE_RBAC_ROLLED_BACK</option>
            </select>
            <div className="flex items-center gap-2">
              <select
                value={logLimit}
                onChange={e => setLogLimit(Number(e.target.value) || 60)}
                aria-label="Activity log limit"
                className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value={50}>Last 50</option>
                <option value={100}>Last 100</option>
                <option value={200}>Last 200</option>
              </select>
              <button
                type="button"
                onClick={() => void fetchActivityLogs()}
                className="min-h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 px-4 py-2 text-xs font-bold text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <span>Reload</span>
              </button>
            </div>
          </div>

          {loadingLogs ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-600">
              <span>Loading sensitive activity logs…</span>
            </div>
          ) : activityLogs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-600">
              <span>No sensitive activity records match your current filters.</span>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                    <tr>
                      <th className="py-3 px-3.5">Occurred At</th>
                      <th className="py-3 px-3.5">Actor</th>
                      <th className="py-3 px-3.5">Operation &amp; Action</th>
                      <th className="py-3 px-3.5">Target</th>
                      <th className="py-3 px-3.5">Outcome</th>
                      <th className="py-3 px-3.5">Reason &amp; Delta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {activityLogs.map(entry => {
                      const diffText = formatDiffSummary(entry.before, entry.after);
                      return (
                        <tr key={entry.logId || entry._id} className="hover:bg-slate-50 align-top">
                          <td className="py-3 px-3.5 text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {entry.occurredAt ? new Date(entry.occurredAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-3 px-3.5">
                            <span className="block font-bold text-slate-900">{entry.actorEmail || entry.actorId}</span>
                            <span className="block text-xs text-slate-600">
                              {entry.actorRole} · {entry.actorTier}
                            </span>
                          </td>
                          <td className="py-3 px-3.5">
                            <span className="block font-mono font-bold text-xs text-slate-900">{entry.action}</span>
                            <span className="block text-xs text-slate-600">
                              op: <code className="font-mono">{entry.operation}</code> · {entry.resourceType}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 text-xs text-slate-700">
                            <span className="block font-semibold text-slate-900">{entry.targetLabel || entry.targetId || '—'}</span>
                            {entry.targetLabel && entry.targetId && entry.targetLabel !== entry.targetId && (
                              <span className="block font-mono text-[11px] text-slate-600">{entry.targetId}</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5">
                            <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold ${OUTCOME_STYLES[entry.outcome] || OUTCOME_STYLES.ALLOWED}`}>
                              {entry.outcome}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 max-w-xs">
                            <span className="block text-slate-700">{entry.reason || '—'}</span>
                            {diffText && (
                              <span className="mt-1 block font-mono text-[11px] text-blue-700 break-words">
                                {diffText}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile card layout */}
              <div className="md:hidden space-y-3">
                {activityLogs.map(entry => {
                  const diffText = formatDiffSummary(entry.before, entry.after);
                  return (
                    <article key={entry.logId || entry._id} className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block font-mono font-bold text-xs text-slate-900 truncate">{entry.action}</span>
                          <span className="block text-xs text-slate-600 tabular-nums">
                            {entry.occurredAt ? new Date(entry.occurredAt).toLocaleString() : '—'}
                          </span>
                        </div>
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold shrink-0 ${OUTCOME_STYLES[entry.outcome] || OUTCOME_STYLES.ALLOWED}`}>
                          {entry.outcome}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700">
                        Actor: <strong className="text-slate-900">{entry.actorEmail || entry.actorId}</strong> ({entry.actorRole} · {entry.actorTier})
                      </p>
                      <p className="text-xs text-slate-600">
                        Target: {entry.targetLabel || entry.targetId || '—'} · Op: <code className="font-mono text-slate-900">{entry.operation}</code>
                      </p>
                      {entry.reason && (
                        <p className="text-xs text-slate-700">{entry.reason}</p>
                      )}
                      {diffText && (
                        <p className="font-mono text-[11px] text-blue-700 break-words">{diffText}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
