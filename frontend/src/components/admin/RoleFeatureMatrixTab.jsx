import React, { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { ComponentLoader, TableSkeleton, ErrorState } from '../common/ComponentLoader';

const PLATFORM_PROTECTED_ROLES = new Set(['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin']);

function formatErrorMessage(err, fallback = 'Operation failed.') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  return err?.response?.data?.message
    || err?.response?.data?.error?.message
    || err?.message
    || fallback;
}

function normalizeCatalogDraft(catalog) {
  if (!catalog) {
    return { features: [], permissions: [], rolePermissions: {}, roleScope: {} };
  }
  return {
    features: [...(catalog.features || [])],
    permissions: (catalog.permissions || []).map(([f, a]) => [f, a]),
    rolePermissions: Object.fromEntries(
      Object.entries(catalog.rolePermissions || {}).map(([role, perms]) => [role, [...(perms || [])]])
    ),
    roleScope: { ...(catalog.roleScope || {}) }
  };
}

export default function RoleFeatureMatrixTab() {
  const [serverState, setServerState] = useState(null);
  const [draftCatalog, setDraftCatalog] = useState(null);
  const [historyData, setHistoryData] = useState({ snapshots: [], audits: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState('matrix');
  const [scopeFilter, setScopeFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCell, setSelectedCell] = useState(null);

  const [previewResult, setPreviewResult] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [newFeatureCode, setNewFeatureCode] = useState('');
  const [newPermissionAction, setNewPermissionAction] = useState('read');

  const [changeReference, setChangeReference] = useState('');
  const [applyConfirmation, setApplyConfirmation] = useState('');
  const [allowConflicts, setAllowConflicts] = useState(false);
  const [syncDatabaseOnSave, setSyncDatabaseOnSave] = useState(true);
  const [saving, setSaving] = useState(false);

  const [redeployEnv, setRedeployEnv] = useState('staging');
  const [redeployConfirmation, setRedeployConfirmation] = useState('');
  const [redeploying, setRedeploying] = useState(false);
  const [lastRedeployResult, setLastRedeployResult] = useState(null);

  const [rollbackTargetId, setRollbackTargetId] = useState('');
  const [rollbackConfirmation, setRollbackConfirmation] = useState('');
  const [rollingBack, setRollingBack] = useState(false);

  const [banner, setBanner] = useState(null);

  const loadCodeRbac = async () => {
    setLoading(true);
    setError('');
    try {
      const [catalogRes, historyRes] = await Promise.all([
        apiClient.get('/api/v1/admin/rbac/code-catalog'),
        apiClient.get('/api/v1/admin/rbac/history').catch(() => ({ data: { data: { snapshots: [], audits: [] } } }))
      ]);
      const data = catalogRes.data?.data || null;
      setServerState(data);
      setDraftCatalog(normalizeCatalogDraft(data?.catalog));
      setPreviewResult(null);
      setHistoryData({
        snapshots: historyRes.data?.data?.snapshots || data?.snapshots || [],
        audits: historyRes.data?.data?.audits || []
      });
    } catch (e) {
      setError(formatErrorMessage(e, 'Failed to load code-level RBAC catalog from Admin Service.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCodeRbac();
  }, []);

  const roles = useMemo(() => Object.keys(draftCatalog?.rolePermissions || {}), [draftCatalog]);

  const filteredRoles = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return roles.filter(role => {
      const scope = draftCatalog?.roleScope?.[role] || 'CUSTOMER';
      if (scopeFilter !== 'ALL' && scope !== scopeFilter) return false;
      if (!q) return true;
      const perms = draftCatalog?.rolePermissions?.[role] || [];
      return role.toLowerCase().includes(q)
        || scope.toLowerCase().includes(q)
        || perms.some(p => p.toLowerCase().includes(q));
    });
  }, [roles, draftCatalog, scopeFilter, searchTerm]);

  const permissionsByFeature = useMemo(() => {
    const map = {};
    for (const feat of draftCatalog?.features || []) {
      map[feat] = [];
    }
    for (const [feat, action] of draftCatalog?.permissions || []) {
      if (!map[feat]) map[feat] = [];
      map[feat].push(`${feat}.${action}`);
    }
    return map;
  }, [draftCatalog]);

  const conflictLookup = useMemo(() => {
    const set = new Set();
    for (const c of serverState?.conflicts || []) {
      set.add(`${c.role}::${c.feature}`);
    }
    return set;
  }, [serverState]);

  const hasUnsavedChanges = useMemo(() => {
    if (!serverState?.catalog || !draftCatalog) return false;
    return JSON.stringify(serverState.catalog) !== JSON.stringify(draftCatalog);
  }, [serverState, draftCatalog]);

  const runPreviewDiff = async (nextDraft = draftCatalog) => {
    if (!nextDraft) return;
    setPreviewLoading(true);
    try {
      const res = await apiClient.post('/api/v1/admin/rbac/preview-diff', { catalog: nextDraft });
      setPreviewResult(res.data?.data || null);
      setBanner(null);
    } catch (e) {
      const data = e?.response?.data?.data;
      if (data) setPreviewResult(data);
      setBanner({ type: 'error', text: formatErrorMessage(e, 'Validation failed for proposed RBAC changes.') });
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleRolePermission = (role, permissionCode) => {
    if (PLATFORM_PROTECTED_ROLES.has(role) && permissionCode === '*') return;
    setDraftCatalog(prev => {
      const current = prev.rolePermissions[role] || [];
      const exists = current.includes(permissionCode);
      const updatedRolePerms = exists
        ? current.filter(p => p !== permissionCode)
        : [...current, permissionCode];
      return {
        ...prev,
        rolePermissions: {
          ...prev.rolePermissions,
          [role]: updatedRolePerms
        }
      };
    });
    setPreviewResult(null);
  };

  const handleAddFeaturePermission = event => {
    event.preventDefault();
    const feature = newFeatureCode.trim().toLowerCase();
    const action = newPermissionAction.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(feature)) {
      setBanner({ type: 'error', text: 'Feature code must use lowercase letters, numbers, dots, underscores, or hyphens.' });
      return;
    }
    if (!/^(?:\*|[a-z][a-z0-9_]{1,47})$/.test(action)) {
      setBanner({ type: 'error', text: 'Action must be * or a lowercase identifier (e.g. read, write, manage).' });
      return;
    }
    setDraftCatalog(prev => {
      const features = prev.features.includes(feature) ? prev.features : [...prev.features, feature];
      const permExists = prev.permissions.some(([f, a]) => f === feature && a === action);
      const permissions = permExists ? prev.permissions : [...prev.permissions, [feature, action]];
      return { ...prev, features, permissions };
    });
    setBanner({ type: 'success', text: `Added capability ${feature}.${action} to draft catalog. Select a cell to assign it to roles.` });
    setNewFeatureCode('');
    setSelectedCell(prev => prev || { role: roles[0] || 'TENANT_OWNER', feature });
    setPreviewResult(null);
  };

  const handleResetDraft = () => {
    setDraftCatalog(normalizeCatalogDraft(serverState?.catalog));
    setPreviewResult(null);
    setBanner({ type: 'info', text: 'Draft reset to current code-level RBAC definition on disk.' });
  };

  const handleApplyModify = async () => {
    if (saving || !draftCatalog) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await apiClient.put('/api/v1/admin/rbac/code-catalog', {
        catalog: draftCatalog,
        changeReference: changeReference.trim(),
        confirmation: applyConfirmation.trim(),
        syncDatabase: syncDatabaseOnSave,
        allowConflicts
      });
      const result = res.data?.data || {};
      setBanner({
        type: 'success',
        text: `Updated ${serverState?.sourceFile || 'AuthorizationCatalogService.js'} · Snapshot ${result.snapshotId} · Hot-reloaded ${result.hotReloaded ? 'active' : 'pending'}.`
      });
      setApplyConfirmation('');
      await loadCodeRbac();
    } catch (e) {
      setBanner({ type: 'error', text: formatErrorMessage(e, 'Could not save code-level RBAC changes.') });
    } finally {
      setSaving(false);
    }
  };

  const handleRedeploy = async () => {
    if (redeploying) return;
    setRedeploying(true);
    setBanner(null);
    try {
      const res = await apiClient.post('/api/v1/admin/rbac/redeploy', {
        changeReference: changeReference.trim() || 'ADMIN-CONSOLE-REDEPLOY',
        confirmation: redeployConfirmation.trim(),
        environment: redeployEnv,
        bumpAllSessions: true
      });
      const result = res.data?.data || null;
      setLastRedeployResult(result);
      setRedeployConfirmation('');
      setBanner({
        type: 'success',
        text: result?.hookOutcome?.triggered
          ? `Redeploy ${result.deploymentId} verified and remote hook triggered.`
          : `Control-plane RBAC ${result?.deploymentId || ''} verified, hot-reloaded, and synchronized.`
      });
      await loadCodeRbac();
    } catch (e) {
      setBanner({ type: 'error', text: formatErrorMessage(e, 'RBAC redeploy failed.') });
    } finally {
      setRedeploying(false);
    }
  };

  const handleRollback = async () => {
    if (rollingBack || !rollbackTargetId) return;
    setRollingBack(true);
    setBanner(null);
    try {
      const res = await apiClient.post('/api/v1/admin/rbac/rollback', {
        snapshotId: rollbackTargetId,
        confirmation: rollbackConfirmation.trim()
      });
      const result = res.data?.data || {};
      setRollbackConfirmation('');
      setRollbackTargetId('');
      setBanner({
        type: 'success',
        text: `Rolled back to snapshot ${result.restoredSnapshotId} and synchronized control-plane RBAC.`
      });
      await loadCodeRbac();
    } catch (e) {
      setBanner({ type: 'error', text: formatErrorMessage(e, 'Rollback failed.') });
    } finally {
      setRollingBack(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <ComponentLoader
          title="Loading Code-Level RBAC Catalog…"
          subtitle="Reading authorization source policy, gateway capability bindings, and database sync state."
          variant="spinner"
        />
        <TableSkeleton rows={8} columns={6} />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load Code-Level RBAC Control Plane"
        message={error}
        onRetry={loadCodeRbac}
      />
    );
  }

  const dbSync = serverState?.databaseSync || {};
  const readiness = serverState?.deployReadiness || {};
  const routeBindings = serverState?.routeBindings || [];
  const conflicts = serverState?.conflicts || [];
  const selectedRolePerms = selectedCell ? (draftCatalog?.rolePermissions?.[selectedCell.role] || []) : [];
  const selectedFeaturePerms = selectedCell ? (permissionsByFeature[selectedCell.feature] || []) : [];

  return (
    <div className="space-y-5 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Code-Level RBAC &amp; Control-Plane Redeploy
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono">{serverState?.sourceFile}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Lines {serverState?.lineRange?.startLine}–{serverState?.lineRange?.endLine}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Digest {String(serverState?.policyDigest || '').slice(0, 12)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasUnsavedChanges && (
            <button
              type="button"
              onClick={handleResetDraft}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0 cursor-pointer"
            >
              Reset Draft
            </button>
          )}
          <button
            type="button"
            onClick={() => void runPreviewDiff(draftCatalog)}
            disabled={previewLoading}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0 cursor-pointer"
          >
            {previewLoading ? 'Validating…' : 'Validate & Diff'}
          </button>
          <button
            type="button"
            onClick={() => void loadCodeRbac()}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reload From Code
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {banner && (
        <div
          role="status"
          className={`rounded-xl p-3.5 border text-xs font-medium flex items-center justify-between gap-3 ${
            banner.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
              : banner.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-xs font-semibold underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="text-xs text-slate-500 dark:text-slate-400">System Roles</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
            {readiness.totalRoles ?? roles.length}
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="text-xs text-slate-500 dark:text-slate-400">Code Permissions</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
            {readiness.totalPermissions ?? (draftCatalog?.permissions?.length || 0)}
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="text-xs text-slate-500 dark:text-slate-400">Gateway Routes</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
            {readiness.totalRouteBindings ?? routeBindings.length}
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="text-xs text-slate-500 dark:text-slate-400">DB Catalog Sync</div>
          <div className="text-sm font-bold text-slate-900 dark:text-white mt-1.5">
            {!dbSync.connected
              ? 'Memory Mode (DB Offline)'
              : dbSync.inSync
                ? 'In Sync'
                : 'Drift Detected'}
          </div>
        </div>
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="text-xs text-slate-500 dark:text-slate-400">Conflict Warnings</div>
          <div className={`text-xl font-bold font-mono tabular-nums mt-0.5 ${conflicts.length ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {conflicts.length}
          </div>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {[
            { id: 'matrix', label: 'Interactive Matrix' },
            { id: 'source', label: 'Code Source & Diff' },
            { id: 'routes', label: `API Route Bindings (${routeBindings.length})` },
            { id: 'deploy', label: hasUnsavedChanges ? 'Modify & Redeploy (Draft Pending)' : 'Modify & Redeploy' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveView(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === tab.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {(activeView === 'matrix' || activeView === 'routes') && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter roles by scope"
              value={scopeFilter}
              onChange={e => setScopeFilter(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
            >
              <option value="ALL">All Scopes</option>
              <option value="PLATFORM">PLATFORM</option>
              <option value="TENANT">TENANT</option>
              <option value="CUSTOMER">CUSTOMER</option>
            </select>
            <input
              type="search"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search role, feature, permission…"
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 w-56"
            />
          </div>
        )}
      </div>

      {/* VIEW 1: Interactive Matrix + Permission Editor */}
      {activeView === 'matrix' && (
        <div className="space-y-5">
          {conflicts.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="font-bold">Privilege Conflict Alerts ({conflicts.length})</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {conflicts.slice(0, 5).map((c, idx) => (
                  <li key={`${c.role}-${c.permission}-${idx}`}>{c.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold bg-slate-50 dark:bg-slate-800/60">
                  <th className="py-3 px-4 sticky left-0 z-10 bg-slate-50 dark:bg-slate-800 min-w-[210px]">
                    Role · Scope
                  </th>
                  {(draftCatalog?.features || []).map(feature => (
                    <th key={feature} className="py-3 px-3 text-center min-w-[115px] font-mono">
                      {feature}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRoles.map(role => {
                  const rolePerms = draftCatalog?.rolePermissions?.[role] || [];
                  const serverRolePerms = serverState?.catalog?.rolePermissions?.[role] || [];
                  const scope = draftCatalog?.roleScope?.[role] || 'CUSTOMER';
                  const hasWildcard = rolePerms.includes('*');

                  return (
                    <tr key={role} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4 sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
                        <div className="font-semibold text-slate-900 dark:text-white">{role}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {scope} · {rolePerms.length} perms
                        </div>
                      </td>

                      {(draftCatalog?.features || []).map(feature => {
                        const featurePerms = permissionsByFeature[feature] || [];
                        const grantedInFeature = featurePerms.filter(
                          p => rolePerms.includes(p) || rolePerms.includes(`${feature}.*`)
                        );
                        const serverGrantedCount = featurePerms.filter(
                          p => serverRolePerms.includes(p) || serverRolePerms.includes(`${feature}.*`)
                        ).length;
                        const isModified =
                          grantedInFeature.length !== serverGrantedCount ||
                          hasWildcard !== serverRolePerms.includes('*');
                        const isConflicting = conflictLookup.has(`${role}::${feature}`);
                        const isSelected = selectedCell?.role === role && selectedCell?.feature === feature;

                        return (
                          <td
                            key={feature}
                            onClick={() => setSelectedCell({ role, feature })}
                            className={`py-2.5 px-3 text-center cursor-pointer transition font-mono tabular-nums ${
                              isSelected
                                ? 'bg-indigo-50 dark:bg-indigo-950/50 ring-1 ring-inset ring-indigo-500'
                                : isModified
                                  ? 'bg-amber-50/70 dark:bg-amber-950/20 hover:bg-amber-100/60'
                                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            {isConflicting ? (
                              <span className="text-rose-600 dark:text-rose-400 font-bold">
                                Conflict ({grantedInFeature.length})
                              </span>
                            ) : hasWildcard ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">* All</span>
                            ) : grantedInFeature.length > 0 ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                {grantedInFeature.length}/{featurePerms.length}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cell Permission Editor & New Capability Adder */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
              {selectedCell ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Inspect &amp; Modify: <span className="font-mono">{selectedCell.role}</span> · <span className="font-mono">{selectedCell.feature}</span>
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Toggle code-level permissions assigned to this role. Changes stage into the live draft before committing to code &amp; redeploying.
                      </p>
                    </div>
                    {PLATFORM_PROTECTED_ROLES.has(selectedCell.role) && (
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Platform root role retains *
                      </span>
                    )}
                  </div>

                  {selectedFeaturePerms.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No granular actions defined under <span className="font-mono">{selectedCell.feature}</span> yet. Add one using the capability form.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {selectedFeaturePerms.map(perm => {
                        const isChecked = selectedRolePerms.includes(perm);
                        const coveredByWildcard = selectedRolePerms.includes('*');
                        return (
                          <label
                            key={perm}
                            className={`flex items-center justify-between gap-3 p-3 rounded-lg border text-xs cursor-pointer transition ${
                              isChecked || coveredByWildcard
                                ? 'border-indigo-300 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30'
                                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{perm}</span>
                            <input
                              type="checkbox"
                              checked={isChecked || coveredByWildcard}
                              disabled={coveredByWildcard && PLATFORM_PROTECTED_ROLES.has(selectedCell.role)}
                              onChange={() => toggleRolePermission(selectedCell.role, perm)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  Select any Role × Feature cell in the matrix above to inspect or modify its code-level permission bindings.
                </div>
              )}
            </div>

            <form
              onSubmit={handleAddFeaturePermission}
              className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Register Feature Capability</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add a new feature or <span className="font-mono">feature.action</span> tuple into the code catalog.
              </p>
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Feature Code
                  <input
                    type="text"
                    value={newFeatureCode}
                    onChange={e => setNewFeatureCode(e.target.value)}
                    placeholder="e.g. compliance"
                    className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Action
                  <input
                    type="text"
                    value={newPermissionAction}
                    onChange={e => setNewPermissionAction(e.target.value)}
                    placeholder="e.g. read, manage, *"
                    className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="w-full py-2 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer whitespace-nowrap"
              >
                Add Capability To Draft
              </button>
            </form>
          </div>
        </div>
      )}

      {/* VIEW 2: Code Source & Diff */}
      {activeView === 'source' && (
        <div className="space-y-4">
          {previewResult?.lineDiff?.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900 dark:text-white">
                  Validated Code Diff Preview
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {previewResult.diff?.hasChanges
                    ? `${previewResult.diff.roleChanges?.length || 0} modified role(s)`
                    : 'No policy diff'}
                </span>
              </div>
              <pre className="p-4 text-[11px] font-mono overflow-x-auto bg-slate-950 text-slate-100 leading-relaxed max-h-96">
                {previewResult.lineDiff.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === 'add'
                        ? 'bg-emerald-950/70 text-emerald-300 px-2'
                        : line.type === 'remove'
                          ? 'bg-rose-950/70 text-rose-300 px-2'
                          : 'px-2 text-slate-300'
                    }
                  >
                    {line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  '}
                    {line.content}
                  </div>
                ))}
              </pre>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900 dark:text-white font-mono">
                {serverState?.sourceFile}
              </span>
              <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                SHA-256 {String(serverState?.policyDigest || '').slice(0, 16)}
              </span>
            </div>
            <pre className="p-4 text-[11px] font-mono overflow-x-auto bg-slate-950 text-slate-100 leading-relaxed max-h-[30rem]">
              {String(serverState?.policySource || '')
                .split('\n')
                .map((line, idx) => (
                  <div key={idx} className="flex gap-4">
                    <span className="text-slate-500 select-none w-8 text-right tabular-nums">
                      {(serverState?.lineRange?.startLine || 1) + idx}
                    </span>
                    <span className="whitespace-pre">{line}</span>
                  </div>
                ))}
            </pre>
          </div>
        </div>
      )}

      {/* VIEW 3: Gateway Route Bindings */}
      {activeView === 'routes' && (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-semibold">
                <th className="py-3 px-4 w-24">Method</th>
                <th className="py-3 px-4">Gateway Pattern</th>
                <th className="py-3 px-4">Required Permission</th>
                <th className="py-3 px-4">Feature</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {routeBindings
                .filter(item => {
                  const q = searchTerm.trim().toLowerCase();
                  if (!q) return true;
                  return `${item.method} ${item.pattern} ${item.permission}`.toLowerCase().includes(q);
                })
                .map((item, idx) => (
                  <tr key={`${item.method}-${item.pattern}-${idx}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-900 dark:text-white">{item.method}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 dark:text-slate-300">{item.pattern}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-indigo-600 dark:text-indigo-400">{item.permission}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400">{item.feature}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* VIEW 4: Commit Code Modify, Control-Plane Redeploy & Rollback */}
      {activeView === 'deploy' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Save Code Changes */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">01. Modify Code-Level RBAC Policy</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Writes validated declarations into <span className="font-mono">AuthorizationCatalogService.js</span>, hot-reloads active memory, and creates an immutable rollback snapshot.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  Change / Ticket Reference
                  <input
                    type="text"
                    value={changeReference}
                    onChange={e => setChangeReference(e.target.value)}
                    placeholder="e.g. RBAC-2026-104"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </label>

                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  Confirmation Phrase (type <span className="font-mono font-bold">APPLY CODE RBAC CHANGE</span>)
                  <input
                    type="text"
                    value={applyConfirmation}
                    onChange={e => setApplyConfirmation(e.target.value)}
                    placeholder="APPLY CODE RBAC CHANGE"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </label>

                <div className="flex flex-wrap gap-4 pt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={syncDatabaseOnSave}
                      onChange={e => setSyncDatabaseOnSave(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Sync MongoDB RBAC &amp; bump session versions</span>
                  </label>

                  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={allowConflicts}
                      onChange={e => setAllowConflicts(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Allow privilege conflict override</span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={handleApplyModify}
                disabled={saving}
                className="w-full py-2.5 px-4 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 transition cursor-pointer whitespace-nowrap"
              >
                {saving ? 'Applying Code Changes…' : 'Save & Hot-Reload Code RBAC'}
              </button>
            </div>

            {/* Redeploy Control Plane */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">02. Verify &amp; Redeploy Admin Control Plane</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Runs syntax verification, lockout invariants, DB reconciliation, deployment manifest validation, and dispatches any configured deploy hook.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  Target Environment
                  <select
                    value={redeployEnv}
                    onChange={e => setRedeployEnv(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="development">development</option>
                    <option value="staging">staging</option>
                    <option value="production">production</option>
                  </select>
                </label>

                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  Confirmation Phrase (type <span className="font-mono font-bold">CONFIRM REDEPLOY</span>)
                  <input
                    type="text"
                    value={redeployConfirmation}
                    onChange={e => setRedeployConfirmation(e.target.value)}
                    placeholder="CONFIRM REDEPLOY"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={handleRedeploy}
                disabled={redeploying}
                className="w-full py-2.5 px-4 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition cursor-pointer whitespace-nowrap"
              >
                {redeploying ? 'Redeploying RBAC…' : 'Verify & Redeploy RBAC'}
              </button>

              {lastRedeployResult && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                  <div className="font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
                    Run {lastRedeployResult.deploymentId} · Artifact {String(lastRedeployResult.artifactDigest || '').slice(0, 12)}
                  </div>
                  <div className="space-y-1.5">
                    {(lastRedeployResult.steps || []).map(step => (
                      <div key={step.id} className="flex items-start justify-between gap-2 text-[11px]">
                        <div>
                          <div className="font-medium text-slate-800 dark:text-slate-200">{step.label}</div>
                          {step.detail && <div className="text-slate-500 dark:text-slate-400">{step.detail}</div>}
                        </div>
                        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 shrink-0 tabular-nums">
                          {step.status} · {step.durationMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Snapshots & Rollback */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">03. Snapshots &amp; Instant Code Rollback</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Every code-level RBAC edit saves a restorable snapshot before writing to disk.
                </p>
              </div>
              {rollbackTargetId && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={rollbackConfirmation}
                    onChange={e => setRollbackConfirmation(e.target.value)}
                    placeholder="Type ROLLBACK CODE RBAC"
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleRollback}
                    disabled={rollingBack}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white cursor-pointer whitespace-nowrap"
                  >
                    {rollingBack ? 'Rolling Back…' : `Restore ${rollbackTargetId}`}
                  </button>
                </div>
              )}
            </div>

            {historyData.snapshots.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No modification snapshots recorded yet. Snapshots are created automatically whenever you commit a code-level RBAC change.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-3">Snapshot ID</th>
                      <th className="py-2.5 px-3">Reference</th>
                      <th className="py-2.5 px-3">Actor</th>
                      <th className="py-2.5 px-3">Previous Digest</th>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {historyData.snapshots.map(snap => (
                      <tr key={snap.snapshotId}>
                        <td className="py-2.5 px-3 font-mono text-slate-900 dark:text-white">{snap.snapshotId}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">{snap.changeReference}</td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{snap.actor}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">{String(snap.previousDigest || '').slice(0, 12)}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">
                          {snap.createdAt ? new Date(snap.createdAt).toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setRollbackTargetId(snap.snapshotId)}
                            className="px-3 py-1 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 cursor-pointer whitespace-nowrap"
                          >
                            Select Rollback
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
