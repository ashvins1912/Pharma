import React, { useMemo, useState } from 'react';

const MOBILE_PATTERN = /^(?:\+?91|0)?[6-9]\d{9}$/;

export default function GoogleProfileOnboarding({ user, onComplete, onLogout }) {
  const [firstName, setFirstName] = useState(user?.firstName || user?.name?.split(' ')?.[0] || '');
  const [lastName, setLastName] = useState(user?.lastName || user?.name?.split(' ')?.slice(1).join(' ') || '');
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth || '');
  const [gender, setGender] = useState(user?.gender || '');
  const [mobileNumber, setMobileNumber] = useState(user?.mobileNumber || user?.mobile || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const mobileValid = useMemo(
    () => !mobileNumber || MOBILE_PATTERN.test(mobileNumber.replace(/[\s()-]/g, '')),
    [mobileNumber]
  );

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (!firstName.trim() || !dateOfBirth || !gender || !mobileNumber.trim() || !mobileValid || !password || !confirmPassword) {
      setError('Please complete the required profile fields and create a password.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must be at least 8 characters with uppercase, lowercase and a number.');
      return;
    }

    setSaving(true);
    try {
      await onComplete?.({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth,
        gender,
        mobileNumber,
        password,
        confirmPassword
      });
    } catch (err) {
      setError(err?.message || 'Could not complete your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/60 px-4 py-6 backdrop-blur-sm animate-fade-in">
      <form
        onSubmit={submit}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        aria-labelledby="profile-completion-title"
      >
        <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 px-5 py-6 sm:px-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-2xl text-white shadow-lg shadow-blue-600/20">
              ⚕️
            </div>
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">
                Profile setup · 1 of 1
              </div>
              <h2 id="profile-completion-title" className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
                Complete your Pharma profile
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">
                One more step before you can use your account.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-5 py-6 sm:px-8 sm:py-7">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="profile-first-name" className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
                First name <span className="text-rose-500">*</span>
              </label>
              <input
                id="profile-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                required
              />
            </div>

            <div>
              <label htmlFor="profile-last-name" className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
                Last name
              </label>
              <input
                id="profile-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="profile-gender" className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
              Gender <span className="text-rose-500">*</span>
            </label>
            <select
              id="profile-gender"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              required
            >
              <option value="">Select gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
              <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
            </select>
          </div>

          <div>
            <label htmlFor="profile-dob" className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
              Date of birth <span className="text-rose-500">*</span>
            </label>
            <input
              id="profile-dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              autoComplete="bday"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
              required
            />
          </div>

          <div>
            <label htmlFor="profile-mobile" className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
              Indian mobile number <span className="text-rose-500">*</span>
            </label>
            <input
              id="profile-mobile"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              Enter a valid Indian mobile number. This is required to complete your profile.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="profile-password" className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
                Create password <span className="text-rose-500">*</span>
              </label>
              <input
                id="profile-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 pr-20 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                placeholder="Create a strong password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="mt-1 text-[11px] font-bold text-blue-600 transition hover:text-blue-800"
              >
                {showPassword ? 'Hide password' : 'Show password'}
              </button>
            </div>
            <div>
              <label htmlFor="profile-confirm-password" className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500">
                Confirm password <span className="text-rose-500">*</span>
              </label>
              <input
                id="profile-confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 pr-20 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                placeholder="Re-enter your password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((visible) => !visible)}
                aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                className="mt-1 text-[11px] font-bold text-blue-600 transition hover:text-blue-800"
              >
                {showConfirmPassword ? 'Hide password' : 'Show password'}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-semibold leading-5 text-rose-700">
              <span aria-hidden="true">⚠️</span>
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-8">
          <button
            type="button"
            onClick={onLogout}
            disabled={saving}
            className="w-full rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Sign out
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          >
            {saving && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            {saving ? 'Saving profile…' : 'Continue securely'}
          </button>
        </div>
      </form>
    </div>
  );
}
