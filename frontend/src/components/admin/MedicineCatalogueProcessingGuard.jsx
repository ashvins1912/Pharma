import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const unwrap = response => response?.data?.data || response?.data || {};
const formatBytes = value => {
  if (value == null || !Number.isFinite(Number(value))) return 'Not reported';
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024, index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(1)} ${units[index]}`;
};
const Metric = ({ label, value, detail }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
    <p className="text-xs font-semibold text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
  </div>
);

export default function MedicineCatalogueProcessingGuard() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/v1/inventory/catalogue/imports/processing-guard', { timeout: 20000 });
      setSnapshot(unwrap(response));
    } catch (failure) {
      setError(failure.response?.data?.message || failure.message || 'Could not load catalogue guard status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runControl = async action => {
    const phrase = action === 'pause' ? 'PAUSE CATALOGUE PROCESSING' : 'RESUME CATALOGUE PROCESSING';
    if (reason.trim().length < 8 || confirmation.trim() !== phrase) {
      setError(`Enter an operational reason (at least 8 characters) and type: ${phrase}`);
      return;
    }
    setBusy(action);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.post('/api/v1/inventory/catalogue/imports/processing-guard/control', {
        action, reason: reason.trim(), confirmation: phrase
      }, { timeout: 20000 });
      const result = unwrap(response);
      setNotice(action === 'pause'
        ? 'Catalogue processing is paused across workers sharing this database.'
        : 'Operator pause removed. Resource protection checks still apply before workers resume.');
      setReason('');
      setConfirmation('');
      await refresh();
      if (result.operatorPaused !== undefined) setSnapshot(current => current ? { ...current, ...result } : result);
    } catch (failure) {
      setError(failure.response?.data?.message || failure.message || 'The guard control request failed.');
    } finally {
      setBusy('');
    }
  };

  const resources = snapshot?.resources || {};
  const process = resources.process || {};
  const host = resources.host || {};
  const queue = snapshot?.queue || {};
  const limits = snapshot?.limits || {};
  const state = snapshot?.state || 'UNKNOWN';
  const paused = Boolean(snapshot?.operatorPaused) || snapshot?.enabled === false;

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Super Admin · Task Operations</p>
            <h2 className="mt-1 text-xl font-black">Medicine Catalogue Processing Guard</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">Monitor catalogue import pressure and manage a centrally persisted operator pause. Resource protection remains automatic and cannot be bypassed by the resume control.</p>
          </div>
          <button type="button" onClick={refresh} disabled={loading || Boolean(busy)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh status'}</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${state === 'READY' ? 'bg-emerald-100 text-emerald-800' : state === 'PAUSED' ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-800'}`}>{state}</span>
          <span className="text-xs text-slate-500">{paused ? 'Operator / environment pause is active' : 'Operator pause is not active'}</span>
          {snapshot?.updatedBy && <span className="text-xs text-slate-500">Last operator: {snapshot.updatedBy}</span>}
        </div>
        {snapshot?.pauseReason && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">Pause reason: {snapshot.pauseReason}</p>}
        {snapshot?.reasons?.length > 0 && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Guard reasons: {snapshot.reasons.join(', ')}</p>}
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Heap used" value={process.heapUsedPercent == null ? 'Not reported' : `${process.heapUsedPercent}%`} detail={`${formatBytes(process.heapUsedBytes)} of ${formatBytes(process.heapLimitBytes)} · limit ${limits.maxHeapPercent ?? '—'}%`} />
        <Metric label="Process RSS" value={formatBytes(process.rssBytes)} detail={`${process.rssUsedPercent ?? '—'}% of configured RSS budget · ${limits.maxRssMb ?? '—'} MB`} />
        <Metric label="Host CPU load" value={host.cpuLoadPercent == null ? 'Not reported' : `${host.cpuLoadPercent}%`} detail={`${host.cpuCount ?? '—'} CPU cores · guard limit ${limits.maxCpuLoadPercent ?? '—'}%`} />
        <Metric label="Queue / active" value={`${queue.queuedJobs ?? '—'} queued / ${queue.activeJobs ?? '—'} active`} detail={`Queue admission cap ${queue.maxQueuedJobs ?? limits.maxQueuedJobs ?? '—'}`} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="font-black">Operator controls</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Pause blocks new catalogue import jobs across service instances sharing this MongoDB database. Existing active jobs are allowed to finish; resume does not retry failed jobs or publish catalogue batches.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">Reason for this change
            <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={500} placeholder="Describe the operational reason (minimum 8 characters)" className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
          </label>
          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">Confirmation phrase
            <input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={paused ? 'RESUME CATALOGUE PROCESSING' : 'PAUSE CATALOGUE PROCESSING'} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
            <span className="mt-2 block text-xs font-normal text-slate-500">Exact phrase required. Every action is recorded with actor, time and reason.</span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => runControl('pause')} disabled={Boolean(busy) || paused} className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy === 'pause' ? 'Pausing…' : 'Pause processing'}</button>
          <button type="button" onClick={() => runControl('resume')} disabled={Boolean(busy) || !snapshot?.operatorPaused} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy === 'resume' ? 'Resuming…' : 'Resume processing'}</button>
        </div>
        {snapshot?.enabled === false && <p className="mt-3 text-xs text-amber-700">The environment setting MEDICINE_CATALOGUE_PROCESSING_ENABLED=false is active. Change the deployment configuration before resuming.</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-black">Operator audit history</h3><p className="text-xs text-slate-500">Most recent 20 events shown; up to 50 are retained in the control record.</p></div><span className="text-xs text-slate-500">{snapshot?.history?.length || 0} events</span></div>
        {!snapshot?.history?.length ? <p className="py-6 text-center text-sm text-slate-500">No manual pause or resume actions recorded.</p> : (
          <div className="mt-3 space-y-2">
            {snapshot.history.map((item, index) => <article key={`${item.at || index}-${index}`} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className={`text-xs font-extrabold ${item.action === 'PAUSE' ? 'text-rose-700' : 'text-emerald-700'}`}>{item.action}</span><time className="text-xs text-slate-500">{item.at ? new Date(item.at).toLocaleString() : 'Time unavailable'}</time></div>
              <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{item.reason}</p>
              <p className="mt-1 text-xs text-slate-500">Actor: {item.actor || 'Unknown'}</p>
            </article>)}
          </div>
        )}
      </section>
      <p className="text-xs text-slate-500">Status refreshes every 15 seconds. Resource-triggered protection remains automatic; this panel only changes the persisted operator pause.</p>
    </section>
  );
}
