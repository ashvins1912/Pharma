import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';

const API = '/api/v1/admin/infrastructure/security';
const authHelp = {
  api_token: 'Enter JSON such as {"token":"…"} or {"apiToken":"…"}',
  oauth2_client_credentials: 'Enter JSON such as {"clientId":"…","clientSecret":"…","tokenUrl":"https://…"}',
  oauth2_authorization_code: 'Enter the provider-issued refresh token and client details required by your adapter.',
  basic: 'Enter JSON such as {"username":"…","password":"…"}',
  service_account: 'Enter the service-account fields required by your provider adapter.',
  custom: 'Enter the credential fields documented by your custom adapter.'
};

export default function InfrastructureSecurityPanel() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [targetConfigText, setTargetConfigText] = useState('{}');
  const [form, setForm] = useState({ name: '', provider: '', environment: 'staging', authMethod: 'api_token', endpoint: '', credentials: '{\n  "token": ""\n}', requestedScopes: ['read', 'monitor'], requestedCapabilities: ['read', 'monitor'] });

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get(`${API}/integrations`, { timeout: 15000 });
      setItems(response.data?.integrations || response.data?.data?.integrations || []);
    } catch (failure) {
      setError(failure.response?.data?.message || 'Could not load saved integrations.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const toggle = (key, value) => setForm(current => ({
    ...current, [key]: current[key].includes(value)
      ? current[key].filter(item => item !== value) : [...current[key], value]
  }));

  const save = async event => {
    event.preventDefault();
    setBusy('save'); setError(''); setNotice('');
    try {
      let credentials;
      try { credentials = JSON.parse(form.credentials); }
      catch { throw new Error('Credentials must be valid JSON for the selected authentication method.'); }
      if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('Credentials must be a JSON object.');
      const response = await apiClient.post(`${API}/integrations`, {
        name: form.name, provider: form.provider, environment: form.environment,
        authMethod: form.authMethod, endpoint: form.endpoint || null, credentials,
        requestedScopes: form.requestedScopes, requestedCapabilities: form.requestedCapabilities
      }, { timeout: 20000 });
      setNotice(response.data?.message || 'Encrypted credentials saved. Verify the connection next.');
      setForm(current => ({ ...current, credentials: '{}' }));
      await load();
    } catch (failure) {
      setError(failure.response?.data?.message || failure.message || 'Could not save integration.');
    } finally { setBusy(''); }
  };

  const verify = async id => {
    setBusy(id); setError(''); setNotice('');
    try {
      const response = await apiClient.post(`${API}/integrations/${encodeURIComponent(id)}/verify`, {}, { timeout: 30000 });
      setNotice(response.data?.message || 'Verification finished.');
      setSelected(response.data?.integration || null);
      await load();
    } catch (failure) {
      setError(failure.response?.data?.message || 'Verification failed. Credentials are not displayed.');
      await load();
    } finally { setBusy(''); }
  };

  const showAudit = async id => {
    const item = items.find(item => String(item._id) === String(id)) || null;
    setSelected(item);
    setTargetConfigText(JSON.stringify(item?.targetConfig || {}, null, 2));
    setAudit([]);
    try {
      const response = await apiClient.get(`${API}/integrations/${encodeURIComponent(id)}/audit`, { timeout: 15000 });
      setAudit(response.data?.entries || []);
    } catch (failure) { setError(failure.response?.data?.message || 'Could not load audit evidence.'); }
  };

  const saveTargetConfig = async id => {
    setBusy(id); setError(''); setNotice('');
    try {
      let targetConfig;
      try { targetConfig = JSON.parse(targetConfigText); }
      catch { throw new Error('Target configuration must be valid JSON.'); }
      if (!targetConfig || typeof targetConfig !== 'object' || Array.isArray(targetConfig)) throw new Error('Target configuration must be a JSON object.');
      const response = await apiClient.put(`${API}/integrations/${encodeURIComponent(id)}/target-config`, { targetConfig }, { timeout: 20000 });
      setSelected(response.data?.integration || null);
      setNotice('Target configuration saved. Re-verify the integration before running preflight or deployment.');
      await load();
    } catch (failure) {
      setError(failure.response?.data?.message || failure.message || 'Could not save target configuration.');
    } finally { setBusy(''); }
  };

  const revoke = async id => {
    if (!window.confirm('Revoke this saved credential? The integration will stop using it.')) return;
    setBusy(id); setError(''); setNotice('');
    try {
      const response = await apiClient.post(`${API}/integrations/${encodeURIComponent(id)}/revoke`, {});
      setNotice(response.data?.message || 'Credential revoked.');
      setSelected(null); await load();
    } catch (failure) { setError(failure.response?.data?.message || 'Could not revoke credential.'); }
    finally { setBusy(''); }
  };

  return <section className="space-y-4 rounded-2xl border border-indigo-200 bg-white p-4 dark:border-indigo-900 dark:bg-slate-900">
    <div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Security governance</p><h3 className="text-lg font-black">Saved services · Credential vault & compliance</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Save encrypted provider credentials once, then verify again without re-entering them. Credentials are write-only and never returned to this screen.</p></div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <form onSubmit={save} className="grid gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800 sm:grid-cols-2">
      <label className="text-xs font-semibold">Service display name<input required maxLength={120} value={form.name} onChange={e => update('name', e.target.value)} placeholder="Production AWS account" className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-900" /></label>
      <label className="text-xs font-semibold">Provider ID<input required pattern="[a-z][a-z0-9_-]{0,63}" value={form.provider} onChange={e => update('provider', e.target.value.toLowerCase())} placeholder="aws, azure, custom-vps" className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-900" /></label>
      <label className="text-xs font-semibold">Environment<select value={form.environment} onChange={e => update('environment', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-900"><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option></select></label>
      <label className="text-xs font-semibold">Authentication method<select value={form.authMethod} onChange={e => update('authMethod', e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-900"><option value="api_token">API token</option><option value="oauth2_client_credentials">OAuth 2.0 client credentials</option><option value="oauth2_authorization_code">OAuth 2.0 authorisation code</option><option value="basic">Basic authentication</option><option value="service_account">Service account</option><option value="custom">Custom adapter</option></select></label>
      <label className="text-xs font-semibold sm:col-span-2">Provider endpoint (optional)<input type="url" value={form.endpoint} onChange={e => update('endpoint', e.target.value)} placeholder="https://api.provider.example" className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-slate-900" /></label>
      <label className="text-xs font-semibold sm:col-span-2">Credentials payload · encrypted before storage<textarea required rows={4} spellCheck={false} autoComplete="off" value={form.credentials} onChange={e => update('credentials', e.target.value)} className="mt-1 w-full rounded-lg border p-2 font-mono text-xs dark:bg-slate-900" /><span className="mt-1 block font-normal text-slate-500">{authHelp[form.authMethod]}</span></label>
      <fieldset className="rounded-lg border p-3"><legend className="px-1 text-xs font-bold">Requested scopes</legend>{[['read','Read resources'],['monitor','Monitor metrics'],['operate','Operate resources'],['manage','Manage configuration'],['credential_admin','Credential administration']].map(([value,label]) => <label key={value} className="mr-3 inline-flex items-center gap-1 py-1 text-xs"><input type="checkbox" checked={form.requestedScopes.includes(value)} onChange={() => toggle('requestedScopes', value)} />{label}</label>)}</fieldset>
      <fieldset className="rounded-lg border p-3"><legend className="px-1 text-xs font-bold">Requested capabilities</legend>{[['read','Read'],['monitor','Monitor'],['start','Start'],['stop','Stop'],['restart','Restart'],['deploy','Deploy'],['scale','Scale'],['backup','Backup'],['restore','Restore'],['manage','Manage']].map(([value,label]) => <label key={value} className="mr-3 inline-flex items-center gap-1 py-1 text-xs"><input type="checkbox" checked={form.requestedCapabilities.includes(value)} onChange={() => toggle('requestedCapabilities', value)} />{label}</label>)}</fieldset>
      <div className="flex items-center justify-between gap-2 sm:col-span-2"><p className="text-xs text-slate-500">New connections start pending verification. Read-only is the recommended default.</p><button disabled={Boolean(busy)} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === 'save' ? 'Encrypting…' : 'Save encrypted service'}</button></div>
    </form>
    <div className="space-y-2"><div className="flex items-center justify-between"><h4 className="font-bold">Recently saved services</h4><button type="button" onClick={load} className="text-xs font-bold underline">Refresh</button></div>
      {!items.length && <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">No saved remote services yet.</p>}
      {items.map(item => <article key={item._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
        <div className="min-w-0"><p className="font-bold">{item.name} <span className="ml-1 text-xs font-normal text-slate-500">({item.provider})</span></p><p className="text-xs text-slate-500">{item.environment} · {item.authMethod} · {item.state} · Compliance: {item.complianceState}</p><p className="text-xs text-slate-500">Last verified: {item.lastVerifiedAt ? new Date(item.lastVerifiedAt).toLocaleString() : 'Never'} · Scopes: {(item.grantedScopes || []).join(', ') || 'Not verified'}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => verify(item._id)} className="rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50">{busy === item._id ? 'Verifying…' : 'Verify saved credentials'}</button><button type="button" onClick={() => showAudit(item._id)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Evidence</button><button type="button" disabled={Boolean(busy)} onClick={() => revoke(item._id)} className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-50">Revoke</button></div>
      </article>)}
    </div>
    {selected && <div className="rounded-xl border p-3"><div className="flex justify-between gap-2"><h4 className="font-bold">Verification & audit evidence · {selected.name}</h4><button type="button" onClick={() => setSelected(null)} className="text-xs underline">Close</button></div><div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800"><label className="block text-xs font-bold">Provider deployment target configuration · non-secret JSON<textarea rows={7} spellCheck={false} value={targetConfigText} onChange={e => setTargetConfigText(e.target.value)} className="mt-1 w-full rounded-lg border p-2 font-mono text-xs dark:bg-slate-900" /></label><p className="mt-1 text-xs text-slate-500">Cloud providers require account/resource targets, an existing remote Terraform state backend and allowed service names. Kubernetes requires its namespace and allowed deployment names. LaunchDarkly requires project/environment keys and allowed flag keys. Changing this configuration invalidates verification.</p><button type="button" disabled={Boolean(busy)} onClick={() => saveTargetConfig(selected._id)} className="mt-2 rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy === selected._id ? 'Saving…' : 'Save target configuration'}</button></div><div className="mt-2 grid gap-2 sm:grid-cols-2">{(selected.policyEvidence || []).map(item => <div key={item.controlId} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800"><p className="font-bold">{item.controlId} · {item.status}</p><p className="text-slate-500">{item.detail}</p></div>)}</div><h5 className="mt-3 text-sm font-bold">Audit events</h5>{audit.map((entry, index) => <div key={entry._id || index} className="border-t py-2 text-xs"><p className="font-semibold">{entry.event} · {entry.outcome}</p><p className="text-slate-500">{new Date(entry.occurredAt).toLocaleString()} · Actor: {entry.actor}</p></div>)}</div>}
  </section>;
}
