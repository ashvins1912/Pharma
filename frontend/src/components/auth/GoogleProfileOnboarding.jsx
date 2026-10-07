import React, { useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';

const MOBILE_PATTERN = /^(?:\\+?91|0)?[6-9]\\d{9}$/;

export default function GoogleProfileOnboarding({ user, onComplete, onLogout }) {
  const [firstName, setFirstName] = useState(user?.firstName || user?.name?.split(' ')?.[0] || '');
  const [lastName, setLastName] = useState(user?.lastName || user?.name?.split(' ')?.slice(1).join(' ') || '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth || '');
  const [gender, setGender] = useState(user?.gender || '');
  const [mobileNumber, setMobileNumber] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const mobileValid = useMemo(() => MOBILE_PATTERN.test(mobileNumber.replace(/[\\s()-]/g, '')), [mobileNumber]);

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (!firstName.trim() || !dateOfBirth || !gender || !mobileValid) {
      setError('Please complete your name, gender, date of birth and valid Indian mobile number.');
      return;
    }

    setSaving(true);
    try {
      const { data } = await apiClient.put('/api/v1/auth/complete-profile', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth,
        gender,
        mobileNumber
      });
      onComplete?.(data?.data || data);
    } catch (err) {
      setError(err?.message || 'Could not complete your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,display:'grid',placeItems:'center',background:'rgba(15,23,42,.62)',padding:20}}>
      <form onSubmit={submit} style={{width:'min(520px,100%)',background:'#fff',borderRadius:20,padding:28,boxShadow:'0 24px 80px rgba(0,0,0,.25)'}}>
        <h2 style={{margin:'0 0 8px'}}>Complete your Pharma profile</h2>
        <p style={{margin:'0 0 22px',color:'#64748b'}}>One more step before you can use your account.</p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <label>First name<input value={firstName} onChange={e=>setFirstName(e.target.value)} required /></label>
          <label>Last name<input value={lastName} onChange={e=>setLastName(e.target.value)} /></label>
        </div>

        <label>Gender
          <select value={gender} onChange={e=>setGender(e.target.value)} required>
            <option value="">Select gender</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
            <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
          </select>
        </label>

        <label>Date of birth<input type="date" value={dateOfBirth} onChange={e=>setDateOfBirth(e.target.value)} required /></label>
        <label>Indian mobile number<input inputMode="tel" placeholder="9876543210 / +91 9876543210" value={mobileNumber} onChange={e=>setMobileNumber(e.target.value)} required /></label>

        {error && <div role="alert" style={{color:'#b91c1c',margin:'10px 0'}}>{error}</div>}

        <div style={{display:'flex',gap:10,marginTop:18}}>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Continue securely'}</button>
          <button type="button" onClick={onLogout} disabled={saving}>Sign out</button>
        </div>
      </form>
    </div>
  );
}
