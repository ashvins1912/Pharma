import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';

const API = '/api/v1/admin/devops';
const unwrap = response => response?.data?.data || response?.data || {};
const errorMessage = failure => failure.response?.data?.message || failure.message || 'DevOps operation failed.';
const confirmPhrase = (message, phrase) => window.prompt(`${message}\nType "${phrase}" to continue.`) === phrase;

export default function DevOpsDeploymentCenter() {
  const [catalog, setCatalog] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [configurations, setConfigurations] = useState([]);
  const [flagChanges, setFlagChanges] = useState([]);
  const [artifact, setArtifact] = useState(null);
  const [selectedFile, setSelectedFile] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    serviceName: 'inventory-service', runtime: 'node', provider: 'kubernetes',
    environment: 'staging', strategy: 'progressive', port: 3001, replicas: 2,
    cpuRequest: '100m', memoryRequest: '128Mi', image: ''
  });
  const [integrationId, setIntegrationId] = useState('');
  const [changeReference, setChangeReference] = useState('');
  const [configForm, setConfigForm] = useState({
    serviceName: 'inventory-service', environment: 'staging', changeReference: '',
    values: '{\n  "NODE_ENV": "staging",\n  "PORT": 3001,\n  "LOG_LEVEL": "info"\n}',
    secretRefs: '{\n  "DATABASE_URL": "secret://pharma/staging/inventory/database-url",\n  "JWT_SECRET": "secret://pharma/staging/inventory/jwt-secret"\n}'
  });
  const [flagForm, setFlagForm] = useState({
    integrationId: '', environment: 'staging', flagKey: '', strategy: 'progressive',
    rolloutPercent: 100, changeReference: ''
  });

  const load = useCallback(async () => {
    setError('');
    const results = await Promise.allSettled([
      apiClient.get(`${API}/catalog`),
      apiClient.get(`${API}/artifacts`),
      apiClient.get(`${API}/deployments`),
      apiClient.get('/api/v1/admin/infrastructure/security/integrations'),
      apiClient.get(`${API}/configurations`),
      apiClient.get(`${API}/feature-flags/changes`)
    ]);
    const [c, a, d, i, cfg, flags] = results;
    if (c.status === 'fulfilled') setCatalog(unwrap(c.value));
    else setError(errorMessage(c.reason));
    if (a.status === 'fulfilled') setArtifacts(unwrap(a.value).artifacts || []);
    if (d.status === 'fulfilled') setDeployments(unwrap(d.value).deployments || []);
    if (i.status === 'fulfilled') setIntegrations(unwrap(i.value).integrations || []);
    if (cfg.status === 'fulfilled') setConfigurations(unwrap(cfg.value).configurations || []);
    if (flags.status === 'fulfilled') setFlagChanges(unwrap(flags.value).changes || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cloudIntegrations = useMemo(() => integrations.filter(item =>
    !item.revokedAt && item.requestedCapabilities?.includes('deploy')
      && item.verification?.authenticated && item.verification?.discoveryPassed
  ), [integrations]);
  const flagIntegrations = useMemo(() => integrations.filter(item =>
    item.provider === 'launchdarkly' && !item.revokedAt
      && item.requestedCapabilities?.includes('manage')
      && item.verification?.authenticated && item.verification?.discoveryPassed
  ), [integrations]);

  const updateForm = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const run = async (key, action) => {
    setBusy(key); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(''); }
  };

  const generate = () => run('generate', async () => {
    const response = await apiClient.post(`${API}/artifacts/generate`, {
      ...form, port: Number(form.port), replicas: Number(form.replicas)
    }, { timeout: 30000 });
    const payload = unwrap(response);
    setArtifact({ ...payload.artifact, files: payload.files });
    setSelectedFile(payload.files?.[0]?.path || '');
    setNotice('Versioned deployment artifacts generated and passed the initial policy checks.');
    await load();
  });

  const validate = () => artifact?.id && run('validate', async () => {
    const response = await apiClient.post(`${API}/artifacts/${encodeURIComponent(artifact.id)}/validate`, {});
    const payload = unwrap(response);
    setArtifact(current => current ? ({ ...current, validation: payload.validation }) : current);
    setNotice(payload.validation?.status === 'PASS' ? 'Artifact validation passed.' : (payload.validation?.errors || []).join(' · '));
    await load();
  });

  const planDeployment = () => artifact?.id && run('plan', async () => {
    if (form.environment === 'staging') {
      const preflight = await apiClient.post(`${API}/providers/preflight`, { provider: form.provider, environment: 'staging', integrationId, artifactId: artifact.id }, { timeout: 900000 });
      if (!unwrap(preflight).success) throw new Error('Provider staging preflight did not pass. Review the provider evidence before planning deployment.');
    }
    const response = await apiClient.post(`${API}/deployments/plan`, {
      artifactId: artifact.id, provider: form.provider, environment: form.environment,
      strategy: form.strategy, integrationId, changeReference
    });
    const payload = unwrap(response);
    setNotice(`Deployment plan ${payload.deployment?._id || ''} created and is awaiting approval.`);
    await load();
  });

  const approve = deployment => {
    if (!confirmPhrase('Approval is recorded in the immutable operational audit. Production requires a different Super Admin from the requester.', 'APPROVE DEPLOYMENT')) return;
    return run(`approve-${deployment._id}`, async () => {
      await apiClient.post(`${API}/deployments/${deployment._id}/approve`, { confirmation: 'APPROVE DEPLOYMENT' });
      setNotice('Deployment approval recorded.');
      await load();
    });
  };

  const execute = deployment => {
    if (!confirmPhrase('This submits the approved deployment to the configured private provider adapter. No terminal session is opened.', 'EXECUTE DEPLOYMENT')) return;
    return run(`execute-${deployment._id}`, async () => {
      const response = await apiClient.post(`${API}/deployments/${deployment._id}/execute`, { confirmation: 'EXECUTE DEPLOYMENT' });
      setNotice(unwrap(response).message || 'Deployment request accepted by provider.');
      await load();
    });
  };

  const refreshDeployment = deployment => run(`status-${deployment._id}`, async () => {
    const response = await apiClient.get(`${API}/deployments/${deployment._id}/status`);
    setNotice(`Provider deployment status: ${unwrap(response).deployment?.status || 'refreshed'}.`);
    await load();
  });

  const rollback = deployment => {
    if (!confirmPhrase('Rollback requests the provider to restore the previous known-good release.', 'ROLLBACK DEPLOYMENT')) return;
    return run(`rollback-${deployment._id}`, async () => {
      const response = await apiClient.post(`${API}/deployments/${deployment._id}/rollback`, { confirmation: 'ROLLBACK DEPLOYMENT' });
      setNotice(unwrap(response).message || 'Rollback accepted.');
      await load();
    });
  };

  const saveConfiguration = () => run('config', async () => {
    const values = JSON.parse(configForm.values);
    const secretRefs = JSON.parse(configForm.secretRefs);
    const response = await apiClient.post(`${API}/configurations`, {
      serviceName: configForm.serviceName, environment: configForm.environment,
      changeReference: configForm.changeReference, values, secretRefs
    });
    setNotice(`Configuration version ${unwrap(response).configuration?.version || ''} saved. Secret values were not submitted.`);
    await load();
  });

  const rolloutFlag = () => run('flag', async () => {
    const response = await apiClient.post(`${API}/feature-flags/rollout`, {
      ...flagForm, rolloutPercent: Number(flagForm.rolloutPercent)
    });
    setNotice(unwrap(response).message || 'LaunchDarkly rollout plan created and awaiting approval.');
    await load();
  });

  const approveFlagChange = change => {
    if (!confirmPhrase('Production flag changes require an independent Super Admin approval.', 'APPROVE FEATURE FLAG CHANGE')) return;
    return run(`flag-approve-${change._id}`, async () => {
      await apiClient.post(`${API}/feature-flags/changes/${change._id}/approve`, { confirmation: 'APPROVE FEATURE FLAG CHANGE' });
      setNotice('Feature-flag change approval recorded.');
      await load();
    });
  };

  const executeFlagChange = change => {
    if (!confirmPhrase('This submits the approved rollout to the LaunchDarkly adapter.', 'EXECUTE FEATURE FLAG CHANGE')) return;
    return run(`flag-execute-${change._id}`, async () => {
      const response = await apiClient.post(`${API}/feature-flags/changes/${change._id}/execute`, { confirmation: 'EXECUTE FEATURE FLAG CHANGE' });
      setNotice(unwrap(response).message || 'LaunchDarkly rollout accepted.');
      await load();
    });
  };

  const rollbackFlagChange = change => {
    if (!confirmPhrase('Restore the captured previous LaunchDarkly flag state. This reverses the submitted rollout.', 'ROLLBACK FEATURE FLAG CHANGE')) return;
    return run(`flag-rollback-${change._id}`, async () => {
      const response = await apiClient.post(`${API}/feature-flags/changes/${change._id}/rollback`, { confirmation: 'ROLLBACK FEATURE FLAG CHANGE' });
      setNotice(unwrap(response).message || 'LaunchDarkly prior state restored.');
      await load();
    });
  };

  const activeFile = artifact?.files?.find(file => file.path === selectedFile);

  return <section className="space-y-5 rounded-2xl border border-sky-200 bg-white p-4 dark:border-sky-900 dark:bg-slate-900">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-sky-700">DevOps automation · IaC · Release governance</p>
        <h3 className="mt-1 text-xl font-black">Deployment Control Center</h3>
        <p className="mt-1 max-w-4xl text-sm text-slate-600 dark:text-slate-300">Generate versioned Docker, Compose, Kubernetes, Terraform, Ansible, CI/CD and runtime configuration artifacts. Plan releases, require approvals, monitor provider execution and request rollbacks.</p>
      </div>
      <button type="button" onClick={load} disabled={Boolean(busy)} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-50">Refresh control plane</button>
    </header>

    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      <strong>Execution boundary:</strong> no remote terminal, shell playground, arbitrary command runner or generic proxy is exposed. Actions use typed APIs and a private provider adapter. Production requires separate approval; credentials remain server-side.
    </div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

    <section className="space-y-3 rounded-xl border p-3">
      <div><h4 className="font-black">1. Generate deployment artifacts</h4><p className="text-xs text-slate-500">Choose the service, runtime, target provider and release strategy. Generated output is a versioned artifact, not an executed deployment.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold">Service name<input value={form.serviceName} onChange={e => updateForm('serviceName', e.target.value)} maxLength={52} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">Runtime<select value={form.runtime} onChange={e => updateForm('runtime', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950">{(catalog?.runtimes || ['node','python','go','java']).map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="text-xs font-semibold">Cloud / platform<select value={form.provider} onChange={e => updateForm('provider', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950">{(catalog?.providers || ['aws','azure','gcp','kubernetes']).filter(x => x !== 'generic').map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="text-xs font-semibold">Environment<select value={form.environment} onChange={e => updateForm('environment', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950">{['development','staging','production'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="text-xs font-semibold">Port<input type="number" min="1" max="65535" value={form.port} onChange={e => updateForm('port', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">Replicas<input type="number" min="1" max="20" value={form.replicas} onChange={e => updateForm('replicas', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">CPU request<input value={form.cpuRequest} onChange={e => updateForm('cpuRequest', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">Memory request<input value={form.memoryRequest} onChange={e => updateForm('memoryRequest', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold sm:col-span-2">Immutable container image tag (optional)<input value={form.image} onChange={e => updateForm('image', e.target.value)} placeholder="ghcr.io/org/service:1.2.3" className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">Release strategy<select value={form.strategy} onChange={e => updateForm('strategy', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950">{(catalog?.strategies || []).map(x => <option key={x.id} value={x.id}>{x.id.replaceAll('_',' ')}</option>)}</select></label>
      </div>
      <button type="button" onClick={generate} disabled={Boolean(busy)} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === 'generate' ? 'Generating…' : 'Generate Docker / IaC / CI-CD bundle'}</button>
      {artifact && <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold">{artifact.serviceName} · {artifact.environment}</p><p className="text-xs text-slate-500">Artifact {artifact.id} · SHA-256 {artifact.digest}</p></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">{artifact.validation?.status || 'GENERATED'}</span></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={validate} disabled={Boolean(busy)} className="rounded-lg border px-3 py-2 text-xs font-bold">Revalidate bundle</button><button type="button" onClick={planDeployment} disabled={Boolean(busy) || artifact.validation?.status !== 'PASS'} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Create deployment plan</button></div>
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <nav className="max-h-64 space-y-1 overflow-auto">{(artifact.files || []).map(file => <button type="button" key={file.path} onClick={() => setSelectedFile(file.path)} className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs ${selectedFile === file.path ? 'bg-sky-100 font-bold text-sky-900' : 'hover:bg-white dark:hover:bg-slate-700'}`}>{file.path}</button>)}</nav>
          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{activeFile?.content || 'Select an artifact file to preview.'}</pre>
        </div>
      </div>}
    </section>

    <section className="space-y-3 rounded-xl border p-3">
      <div><h4 className="font-black">2. Provider integration and deployment approvals</h4><p className="text-xs text-slate-500">Connect cloud providers in Credential Vault with deploy capability and verified operate/manage scope. Production approval must come from a different Super Admin.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">Verified provider integration<select value={integrationId} onChange={e => setIntegrationId(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950"><option value="">Select provider integration</option>{cloudIntegrations.filter(x => x.provider === form.provider && x.environment === form.environment).map(x => <option key={x._id} value={x._id}>{x.name} · {x.provider} · {x.environment}</option>)}</select></label>
        <label className="text-xs font-semibold">Change / ticket reference<input value={changeReference} onChange={e => setChangeReference(e.target.value)} placeholder="CHG-2026-001" className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
      </div>
      {cloudIntegrations.filter(x => x.provider === form.provider && x.environment === form.environment).length === 0 && <p className="text-xs text-amber-700">No verified deploy-capable integration for this provider/environment. Add one in Credential Vault; no provider credentials are needed in this form.</p>}
      <div className="space-y-2">{deployments.map(item => <article key={item._id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold">{item.serviceName} · {item.environment} · {item.strategy}</p><p className="text-xs text-slate-500">{item.provider} · {item.status} · {item.changeReference}</p><p className="text-xs text-slate-500">Requested by {item.requestedBy} · Approved by {item.approvedBy || 'Pending'}</p></div><div className="flex flex-wrap gap-1">
          {item.status === 'PENDING_APPROVAL' && <button type="button" onClick={() => approve(item)} disabled={Boolean(busy)} className="rounded-lg border px-2 py-1 text-xs font-bold">Approve</button>}
          {item.status === 'APPROVED' && <button type="button" onClick={() => execute(item)} disabled={Boolean(busy)} className="rounded-lg bg-indigo-700 px-2 py-1 text-xs font-bold text-white">Execute</button>}
          {item.remoteDeploymentId && <button type="button" onClick={() => refreshDeployment(item)} disabled={Boolean(busy)} className="rounded-lg border px-2 py-1 text-xs font-bold">Refresh status</button>}
          {item.remoteDeploymentId && !['ROLLED_BACK','ROLLBACK_REQUESTED'].includes(item.status) && <button type="button" onClick={() => rollback(item)} disabled={Boolean(busy)} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-bold text-rose-700">Rollback</button>}
        </div></div>
      </article>)}</div>
    </section>

    <section className="space-y-3 rounded-xl border p-3">
      <div><h4 className="font-black">3. Versioned configuration manager</h4><p className="text-xs text-slate-500">Store non-secret runtime values and references to managed secrets. Raw credentials are rejected and are never stored in generated artifacts.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">Service<input value={configForm.serviceName} onChange={e => setConfigForm(x => ({...x,serviceName:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">Environment<select value={configForm.environment} onChange={e => setConfigForm(x => ({...x,environment:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950">{['development','staging','production'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="text-xs font-semibold sm:col-span-2">Non-secret configuration JSON<textarea rows="4" value={configForm.values} onChange={e => setConfigForm(x => ({...x,values:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 font-mono text-xs dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold sm:col-span-2">Managed secret references JSON<textarea rows="4" value={configForm.secretRefs} onChange={e => setConfigForm(x => ({...x,secretRefs:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 font-mono text-xs dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold sm:col-span-2">Change reference<input value={configForm.changeReference} onChange={e => setConfigForm(x => ({...x,changeReference:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
      </div>
      <button type="button" onClick={saveConfiguration} disabled={Boolean(busy)} className="rounded-lg border px-3 py-2 text-sm font-bold">Save immutable configuration version</button>
      <div className="max-h-40 space-y-1 overflow-auto">{configurations.slice(0,10).map(item => <p key={item._id} className="text-xs text-slate-600 dark:text-slate-300">{item.serviceName} · {item.environment} · v{item.version} · {new Date(item.createdAt).toLocaleString()}</p>)}</div>
    </section>

    <section className="space-y-3 rounded-xl border p-3">
      <div><h4 className="font-black">4. LaunchDarkly feature-flag rollout</h4><p className="text-xs text-slate-500">Use canary, progressive, ring, blue/green or kill-switch targeting. The native LaunchDarkly driver owns API credentials, preserves targeting rules, captures the prior state and supports rollback.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">LaunchDarkly integration<select value={flagForm.integrationId} onChange={e => setFlagForm(x => ({...x,integrationId:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950"><option value="">Select verified LaunchDarkly integration</option>{flagIntegrations.map(x => <option key={x._id} value={x._id}>{x.name} · {x.environment}</option>)}</select></label>
        <label className="text-xs font-semibold">Environment<select value={flagForm.environment} onChange={e => setFlagForm(x => ({...x,environment:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950">{['development','staging','production'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="text-xs font-semibold">Feature flag key<input value={flagForm.flagKey} onChange={e => setFlagForm(x => ({...x,flagKey:e.target.value}))} placeholder="new-checkout-flow" className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">Strategy<select value={flagForm.strategy} onChange={e => setFlagForm(x => ({...x,strategy:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950">{['canary','progressive','ring','blue_green','kill_switch'].map(x => <option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></label>
        <label className="text-xs font-semibold">Rollout percentage<input type="number" min="0" max="100" value={flagForm.rolloutPercent} onChange={e => setFlagForm(x => ({...x,rolloutPercent:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
        <label className="text-xs font-semibold">Change reference<input value={flagForm.changeReference} onChange={e => setFlagForm(x => ({...x,changeReference:e.target.value}))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-950" /></label>
      </div>
      <button type="button" onClick={rolloutFlag} disabled={Boolean(busy)} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white">Create feature-flag rollout plan</button>
      <div className="space-y-2">{flagChanges.map(change => <article key={change._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
        <div><p className="font-bold">{change.flagKey} · {change.strategy} · {change.rolloutPercent}%</p><p className="text-xs text-slate-500">{change.environment} · {change.status} · {change.changeReference}</p><p className="text-xs text-slate-500">Requested by {change.requestedBy} · Approved by {change.approvedBy || 'Pending'}</p></div>
        <div className="flex gap-2">{change.status === 'PENDING_APPROVAL' && <button type="button" onClick={() => approveFlagChange(change)} disabled={Boolean(busy)} className="rounded-lg border px-2 py-1 text-xs font-bold">Approve</button>}{change.status === 'APPROVED' && <button type="button" onClick={() => executeFlagChange(change)} disabled={Boolean(busy)} className="rounded-lg bg-violet-700 px-2 py-1 text-xs font-bold text-white">Execute rollout</button>}{change.status === 'SUBMITTED' && <button type="button" onClick={() => rollbackFlagChange(change)} disabled={Boolean(busy)} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-bold text-rose-700">Rollback flag</button>}</div>
      </article>)}</div>
    </section>
  </section>;
}
