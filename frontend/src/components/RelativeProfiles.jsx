import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../api/apiClient';
import { useToast } from '../context/ToastContext';
import { useActionLoading, LOADING_ACTIONS } from '../context/LoadingContext';

const emptyForm = { displayName: '', relationship: '', dateOfBirth: '', gender: '' };

export default function RelativeProfiles({ user }) {
  const { addToast } = useToast();
  const { runAction, isActionLoading } = useActionLoading();
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [openForm, setOpenForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadPeople = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const { data } = await apiClient.get('/api/v1/customers/persons');
      setPeople(data?.data || data || []);
    } catch (error) {
      addToast(error.message || 'Could not load relative profiles.', 'error');
    } finally {
      setLoading(false);
    }
  }, [user?.id, addToast]);

  useEffect(() => { void loadPeople(); }, [loadPeople]);

  const self = useMemo(() => people.find((p) => String(p.relationshipToOwner).toUpperCase() === 'SELF'), [people]);
  const relatives = people.filter((p) => String(p.relationshipToOwner).toUpperCase() !== 'SELF');

  const openRelative = (person) => {
    setSelected(person);
    setForm({
      displayName: person.displayName || '',
      relationship: person.relationshipToOwner || '',
      dateOfBirth: person.dateOfBirth || '',
      gender: person.gender || ''
    });
    setOpenForm(false);
  };

  const saveRelative = async (event) => {
    event.preventDefault();
    if (!form.displayName.trim() || !form.relationship.trim()) {
      addToast('Relative name and relationship are required.', 'warning');
      return;
    }
    const action = selected ? LOADING_ACTIONS.EDIT_RELATIVE : LOADING_ACTIONS.CREATE_RELATIVE;
    await runAction(action, async () => {
      try {
        const response = selected
          ? await apiClient.patch(`/api/v1/customers/persons/${encodeURIComponent(selected.puid)}`, form)
          : await apiClient.post('/api/v1/customers/persons', form);
        const person = response.data?.data || response.data;
        setPeople((current) => selected
          ? current.map((item) => item.puid === person.puid ? person : item)
          : [...current, person]);
        setSelected(person);
        setOpenForm(false);
        addToast(selected ? 'Relative profile updated successfully.' : 'Relative profile created successfully.', 'success');
      } catch (error) {
        addToast(error.message || 'Could not save relative profile.', 'error');
      }
    });
  };

  const removeRelative = async () => {
    if (!selected || !window.confirm(`Remove ${selected.displayName} from your relative profiles?`)) return;
    await runAction(LOADING_ACTIONS.REMOVE_RELATIVE, async () => {
      try {
        await apiClient.delete(`/api/v1/customers/persons/${encodeURIComponent(selected.puid)}`);
        setPeople((current) => current.filter((item) => item.puid !== selected.puid));
        setSelected(null);
        setOpenForm(false);
        addToast('Relative profile removed.', 'success');
      } catch (error) {
        addToast(error.message || 'Could not remove relative profile.', 'error');
      }
    });
  };

  const busy = isActionLoading(LOADING_ACTIONS.CREATE_RELATIVE) || isActionLoading(LOADING_ACTIONS.EDIT_RELATIVE) || isActionLoading(LOADING_ACTIONS.REMOVE_RELATIVE);

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">People & Relatives</h3>
          <p className="text-[10px] text-slate-500">Manage patient profiles and their PUIDs.</p>
        </div>
        <button type="button" onClick={() => { setSelected(null); setForm(emptyForm); setOpenForm(true); }} disabled={busy}
          className="rounded-xl bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700 disabled:opacity-50">+ Add Relative</button>
      </div>

      {self && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
          <p className="text-[10px] font-black uppercase text-blue-600">Your profile</p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black text-slate-900">{self.displayName}</p>
            <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-blue-800">PUID: {self.puid}</span>
          </div>
        </div>
      )}

      {loading && <p className="text-[10px] text-slate-400">Loading people silently...</p>}

      <div className="grid gap-2">
        {relatives.map((person) => (
          <button key={person.puid} type="button" onClick={() => openRelative(person)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50/40">
            <span className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg">👤</span>
              <span><span className="block text-xs font-black text-slate-900">{person.displayName}</span>
              <span className="block text-[10px] text-slate-500">{person.relationshipToOwner}</span></span>
            </span>
            <span className="text-[9px] font-black text-slate-500">View PUID →</span>
          </button>
        ))}
      </div>

      {openForm && (
        <form onSubmit={saveRelative} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Relative name" disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" required />
            <input value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} placeholder="Relationship e.g. Mother" disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" required />
            <input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-xs" />
            <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} disabled={busy} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <option value="">Gender</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white disabled:opacity-60">
              {busy ? 'Saving...' : selected ? 'Update Relative' : 'Create Relative'}
            </button>
            <button type="button" onClick={() => setOpenForm(false)} disabled={busy} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-600">Cancel</button>
          </div>
        </form>
      )}

      {selected && !openForm && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-black text-slate-900">Relative Profile</h4>
            <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-blue-800">PUID: {selected.puid}</span>
          </div>
          <p className="text-xs"><strong>Name:</strong> {selected.displayName}</p>
          <p className="text-xs"><strong>Relationship:</strong> {selected.relationshipToOwner}</p>
          <p className="text-xs"><strong>Date of Birth:</strong> {selected.dateOfBirth || 'Not set'}</p>
          <p className="text-xs"><strong>Gender:</strong> {selected.gender || 'Not set'}</p>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setOpenForm(true)} disabled={busy} className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-700">Edit</button>
            <button type="button" onClick={removeRelative} disabled={busy} className="flex-1 rounded-lg bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-60">
              {isActionLoading(LOADING_ACTIONS.REMOVE_RELATIVE) ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
