import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { friendlyAuthError } from '../api/apiErrors';
import { isSupabaseConfigured } from '../supabaseClient';

const signupFields = ['firstName', 'lastName', 'dateOfBirth', 'mobile', 'email', 'password', 'confirmPassword'];

function validateSignupField(field, values) {
  switch (field) {
    case 'firstName':
      return !values.firstName || values.firstName.trim().length < 1 ? 'First name is required.' : '';
    case 'lastName':
      return '';
    case 'dateOfBirth': {
      if (!values.dateOfBirth) return 'Date of birth is required.';
      const d = new Date(values.dateOfBirth);
      if (Number.isNaN(d.getTime())) return 'Enter a valid date.';
      if (d > new Date()) return 'Date of birth cannot be in the future.';
      return '';
    }
    case 'mobile':
      return values.mobile.replace(/\D/g, '').length < 10 ? 'Mobile number must be at least 10 digits.' : '';
    case 'email':
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(values.email.trim())
        ? ''
        : 'Enter a valid email address.';
    case 'password':
      if (values.password.length < 8) return 'Password must contain at least 8 characters.';
      if (!/[A-Z]/.test(values.password) || !/[a-z]/.test(values.password) || !/[0-9]/.test(values.password)) {
        return 'Use at least one uppercase letter, one lowercase letter, and one number.';
      }
      return '';
    case 'confirmPassword':
      if (!values.confirmPassword) return 'Please confirm your password.';
      return values.confirmPassword !== values.password ? 'Passwords do not match.' : '';
    default:
      return '';
  }
}

export default function AuthModal({ isOpen, onClose }) {
  const {
    loginWithGoogle,
    loginWithEmail,
    verifyTotp,
    cancelMfa,
    mfaRequired,
    mfaChallenge,
    signUpWithEmail,
    completeProfileOnboarding,
    resendVerificationEmail,
    sendPasswordResetEmail,
    updatePassword,
    passwordRecoveryRequired,
    loginDemoCustomer,
    loginDemoAdmin
  } = useAuth();
  const { addToast } = useToast();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [signupEmailVerificationSent, setSignupEmailVerificationSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [signupErrors, setSignupErrors] = useState({});

  // Verification required state when login is rejected due to pending email verification
  const [unverifiedState, setUnverifiedState] = useState(null); // { email: 'masked' }
  const [resendStatus, setResendStatus] = useState('');

  // Profile completion required state (e.g. after first Google login)
  const [profileCompletionState, setProfileCompletionState] = useState(null);

  // Password strength calculation (0 to 4)
  const passwordStrength = React.useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    return score;
  }, [password]);

  const instantDemoEnabled = import.meta.env.VITE_INSTANT_DEMO_ACCESS_ENABLED === 'true'
    || (import.meta.env.DEV && import.meta.env.VITE_INSTANT_DEMO_ACCESS_ENABLED !== 'false');
  const demoCustomerEnabled = instantDemoEnabled
    && (import.meta.env.DEV || import.meta.env.VITE_DEMO_CUSTOMER_ENABLED === 'true');
  const demoAdminEnabled = instantDemoEnabled
    && (import.meta.env.DEV
      ? import.meta.env.VITE_DEMO_ADMIN_ENABLED !== 'false'
      : import.meta.env.VITE_DEMO_ADMIN_ENABLED === 'true');

  const resetForm = () => {
    setIsSignUp(false);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setTotpCode('');
    setIsForgotPassword(false);
    setResetEmailSent(false);
    setSignupEmailVerificationSent(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setFirstName('');
    setLastName('');
    setDateOfBirth('');
    setMobile('');
    setLoading(false);
    setErrorMsg('');
    setSignupErrors({});
    setUnverifiedState(null);
    setResendStatus('');
    setProfileCompletionState(null);
  };

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen]);

  if (!isOpen) return null;

  const getSignupValues = () => ({ firstName, lastName, dateOfBirth, mobile, email, password, confirmPassword });
  const validateSignup = () => {
    const values = getSignupValues();
    const errors = Object.fromEntries(
      signupFields.map((field) => [field, validateSignupField(field, values)])
    );
    setSignupErrors(errors);
    return Object.values(errors).every((error) => !error);
  };

  const handleSignupBlur = (field) => {
    const values = getSignupValues();
    setSignupErrors((current) => {
      const updated = {
        ...current,
        [field]: validateSignupField(field, values)
      };
      if (field === 'password' && values.confirmPassword) {
        updated.confirmPassword = validateSignupField('confirmPassword', values);
      }
      return updated;
    });
  };

  const handleClose = (authenticated = false) => {
    cancelMfa();
    resetForm();
    onClose({ authenticated });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSignUp && !passwordRecoveryRequired && !validateSignup()) return;
    setErrorMsg('');
    setLoading(true);

    try {
      if (passwordRecoveryRequired) {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          setLoading(false);
          return;
        }
        await updatePassword(password);
        addToast('Your password has been reset. You are now signed in.', 'success');
        handleClose(true);
      } else if (isSignUp) {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          setLoading(false);
          return;
        }

        const res = await signUpWithEmail({
          email,
          password,
          firstName,
          lastName,
          dateOfBirth,
          mobileNumber: mobile
        });

        if (res?.requiresEmailVerification || res?.data?.verification?.required || res?.verification?.required) {
          setSignupEmailVerificationSent(true);
        } else {
          addToast('Account created successfully!', 'success');
          handleClose(true);
        }
      } else {
        // Step 1: Submit primary credentials
        const result = await loginWithEmail(email, password);
        if (result.mfaRequired) {
          addToast('Two-factor authentication code required.', 'info');
        } else if (result.requiresProfileCompletion || result.code === 'PROFILE_INCOMPLETE') {
          setProfileCompletionState({
            email: result.user?.email || email,
            firstName: result.user?.firstName || '',
            lastName: result.user?.lastName || ''
          });
        } else {
          addToast('Signed in successfully!', 'success');
          handleClose(true);
        }
      }
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.code === 'EMAIL_VERIFICATION_REQUIRED' || errData?.error?.code === 'EMAIL_VERIFICATION_REQUIRED' || err.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setUnverifiedState({
          email: errData?.email || errData?.error?.email || email,
          rawEmail: email
        });
      } else if (errData?.code === 'ACCOUNT_ACTIVATION_REQUIRED' || errData?.error?.code === 'ACCOUNT_ACTIVATION_REQUIRED') {
        setUnverifiedState({
          email: errData?.email || errData?.error?.email || email,
          rawEmail: email,
          isActivation: true
        });
      } else {
        setErrorMsg(isSignUp ? friendlyAuthError(err, 'signup') : friendlyAuthError(err, 'login'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpVerify = async (e) => {
    if (e) e.preventDefault();
    if (totpCode.trim().length !== 6) {
      setErrorMsg('Please enter a valid 6-digit verification code.');
      return;
    }

    setErrorMsg('');
    setLoading(true);

    try {
      await verifyTotp(totpCode.trim());
      addToast('🛡️ Two-Factor Authentication verified. Signed in!', 'success');
      handleClose(true);
    } catch (err) {
      setErrorMsg('That verification code could not be confirmed. Check the code and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendPasswordReset = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      await sendPasswordResetEmail(email);
      setResetEmailSent(true);
    } catch (err) {
      setErrorMsg(friendlyAuthError(err, 'password reset'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await loginWithGoogle();
      handleClose(true);
    } catch (err) {
      setErrorMsg(friendlyAuthError(err, 'Google sign-in'));
      setLoading(false);
    }
  };

  const handleResendFromUnverified = async () => {
    const targetEmail = unverifiedState?.rawEmail || email;
    if (!targetEmail) return;
    setLoading(true);
    setResendStatus('');
    try {
      await resendVerificationEmail(targetEmail);
      setResendStatus('A new activation link has been sent to your email.');
      addToast('Activation email resent!', 'success');
    } catch (e) {
      setResendStatus('Failed to send verification email. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileCompletionSubmit = async (e) => {
    e.preventDefault();
    if (!firstName.trim()) {
      setErrorMsg('First name is required.');
      return;
    }
    if (!dateOfBirth) {
      setErrorMsg('Date of birth is required.');
      return;
    }
    const d = new Date(dateOfBirth);
    if (Number.isNaN(d.getTime()) || d > new Date()) {
      setErrorMsg('Date of birth must be a valid past date.');
      return;
    }
    if (!mobile || mobile.replace(/\D/g, '').length < 10) {
      setErrorMsg('Mobile number must be at least 10 digits.');
      return;
    }

    setErrorMsg('');
    setLoading(true);

    try {
      await completeProfileOnboarding({
        firstName,
        lastName,
        dateOfBirth,
        mobileNumber: mobile
      });
      addToast('Profile completed successfully! Welcome to Ashvin Pharmacy.', 'success');
      handleClose(true);
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to complete profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoCustomer = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await loginDemoCustomer();
      addToast('Logged in as Demo Customer!', 'success');
      handleClose(true);
    } catch (err) {
      setErrorMsg(friendlyAuthError(err, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const handleDemoAdmin = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await loginDemoAdmin();
      addToast('Logged in as Demo Admin!', 'success');
      handleClose(true);
    } catch (err) {
      setErrorMsg(friendlyAuthError(err, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const todayIso = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overflow-x-hidden bg-white border border-slate-200 rounded-3xl shadow-2xl p-5 sm:p-8 relative">
        
        {/* Close Button */}
        <button
          onClick={() => handleClose(false)}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
        >
          ✕
        </button>

        {/* Shop Logo & Title */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 text-white flex items-center justify-center text-3xl shadow-md shadow-blue-500/25 mb-3">
            {mfaRequired ? '🛡️' : unverifiedState ? '✉️' : profileCompletionState ? '📋' : '⚕️'}
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {mfaRequired
              ? 'Two-Factor Authentication'
              : unverifiedState
              ? 'Email Verification Required'
              : profileCompletionState
              ? 'Complete Your Profile'
              : 'Welcome to Ashvin Pharmacy'}
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            {mfaRequired
              ? `Enter the 6-digit TOTP code for ${mfaChallenge?.email || 'your account'}`
              : unverifiedState
              ? 'Your email address has not been verified yet.'
              : profileCompletionState
              ? 'Please provide your healthcare details to activate your account.'
              : passwordRecoveryRequired
              ? 'Choose a new password for your account'
              : isForgotPassword
              ? 'We will email you a secure password reset link'
              : isSignUp
              ? 'Create your prescription & healthcare account'
              : 'Your trusted pharmacy partner for everyday healthcare'}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* VIEW 1: UNVERIFIED EMAIL ACTIVATION SCREEN */}
        {unverifiedState ? (
          <div className="space-y-4 animate-fade-in text-center">
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-relaxed">
              <p className="font-bold mb-1">Your email address has not been verified.</p>
              <p>
                An activation link was sent to <span className="font-mono font-bold text-slate-900">{unverifiedState.email}</span>.
                Please check your inbox (and spam folder) to activate your account before logging in.
              </p>
            </div>

            {resendStatus && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
                {resendStatus}
              </div>
            )}

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={handleResendFromUnverified}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 cursor-pointer transition flex items-center justify-center gap-2"
              >
                {loading ? 'Sending link...' : 'Resend verification email'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setUnverifiedState(null);
                  setEmail('');
                  setPassword('');
                  setErrorMsg('');
                }}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Change email / Try another account
              </button>

              <button
                type="button"
                onClick={() => handleClose(false)}
                className="w-full text-slate-400 hover:text-slate-600 font-medium py-1.5 text-xs transition cursor-pointer"
              >
                Dismiss & Close
              </button>
            </div>
          </div>
        ) : profileCompletionState ? (
          /* VIEW 2: PROFILE ONBOARDING / COMPLETION SCREEN */
          <form onSubmit={handleProfileCompletionSubmit} className="space-y-3.5 animate-fade-in">
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs">
              <span className="font-bold">Required Details:</span> To comply with prescription and pharmacy dispensing regulations, please complete your date of birth and mobile number.
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Verified Email
              </label>
              <input
                type="email"
                value={profileCompletionState.email}
                disabled
                className="w-full px-3.5 py-2.5 text-xs bg-slate-100 border border-slate-200 rounded-xl text-slate-500 font-medium cursor-not-allowed"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  placeholder="Ashvin"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  placeholder="Singh"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Date of Birth * (For Prescription & Dosage Safety)
              </label>
              <input
                type="date"
                max={todayIso}
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Mobile Number * (For Delivery & OTP Alerts)
              </label>
              <input
                type="tel"
                placeholder="e.g. 9876543210"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 cursor-pointer transition"
            >
              {loading ? 'Activating Profile...' : 'Save & Activate Account →'}
            </button>
          </form>
        ) : mfaRequired ? (
          /* VIEW 3: TOTP MULTI-FACTOR AUTHENTICATION SCREEN */
          <form onSubmit={handleTotpVerify} className="space-y-4 animate-fade-in">
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-center space-y-1">
              <span className="text-[11px] font-black uppercase text-indigo-700 tracking-wider">
                Zero-Cost Authenticator App
              </span>
              <p className="text-xs text-slate-600 leading-relaxed">
                Check Google Authenticator, Microsoft Authenticator, or Bitwarden on your mobile device for the 6-digit code.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 text-center">
                6-Digit Security Code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setTotpCode(val);
                  if (val.length === 6) {
                    setTimeout(() => {
                      if (!loading) handleTotpVerify();
                    }, 50);
                  }
                }}
                placeholder="000 000"
                className="w-full text-center tracking-[0.35em] font-mono font-black text-2xl py-3 bg-slate-50 border border-slate-200 focus:border-indigo-600 focus:bg-white rounded-xl outline-none transition"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-indigo-600/20 cursor-pointer transition flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Verifying Code...</span>
                </>
              ) : (
                <span>Verify & Sign In</span>
              )}
            </button>

            <button
              type="button"
              onClick={cancelMfa}
              className="w-full text-center text-xs font-bold text-slate-500 hover:text-slate-800 py-1 transition cursor-pointer"
            >
              ← Back to password sign-in
            </button>
          </form>
        ) : (
          /* VIEW 4: STANDARD AUTHENTICATION & REGISTRATION SCREEN */
          <>
            {signupEmailVerificationSent ? (
              <div className="text-center py-4 space-y-4">
                <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mx-auto text-2xl font-black">
                  ✉️
                </div>
                <h3 className="text-lg font-black text-slate-800">Check Your Email</h3>
                <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
                  We've sent an activation link to <span className="font-bold text-slate-900">{email}</span>. Please click the link in the email to activate your account before logging in.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSignupEmailVerificationSent(false);
                      setIsSignUp(false);
                      setErrorMsg('');
                    }}
                    className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
                  >
                    Proceed to Sign In →
                  </button>
                </div>
              </div>
            ) : resetEmailSent && isForgotPassword ? (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                If an account exists for {email}, a password reset link has been sent. Check your inbox and follow the link to choose a new password.
              </div>
            ) : null}

            {!resetEmailSent && !signupEmailVerificationSent && (
              <form onSubmit={isForgotPassword ? handleSendPasswordReset : handleSubmit} className="space-y-3.5">
                {(import.meta.env.DEV || import.meta.env.VITE_DEMO_ADMIN_ENABLED === 'true') && import.meta.env.VITE_DEMO_ADMIN_ENABLED !== 'false' && !isSignUp && !isForgotPassword && !passwordRecoveryRequired && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-[11px] text-purple-800">
                    Local demo admin credentials are configured in the backend environment, or click <span className="font-bold">🛡️ Demo Admin</span> below.
                  </div>
                )}

                {isSignUp && !passwordRecoveryRequired && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          First Name *
                        </label>
                        <input
                          type="text"
                          placeholder="Ashvin"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          onBlur={() => handleSignupBlur('firstName')}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                          required
                        />
                        {signupErrors.firstName && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.firstName}</p>}
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Last Name
                        </label>
                        <input
                          type="text"
                          placeholder="Singh"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Date of Birth *
                        </label>
                        <input
                          type="date"
                          max={todayIso}
                          value={dateOfBirth}
                          onChange={(e) => setDateOfBirth(e.target.value)}
                          onBlur={() => handleSignupBlur('dateOfBirth')}
                          aria-invalid={Boolean(signupErrors.dateOfBirth)}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                          required
                        />
                        {signupErrors.dateOfBirth && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.dateOfBirth}</p>}
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Mobile Number *
                        </label>
                        <input
                          type="tel"
                          placeholder="9876543210"
                          value={mobile}
                          onChange={(e) => setMobile(e.target.value)}
                          onBlur={() => handleSignupBlur('mobile')}
                          aria-invalid={Boolean(signupErrors.mobile)}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                          required
                        />
                        {signupErrors.mobile && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.mobile}</p>}
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    placeholder="you@ashvinpharma.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={isSignUp ? () => handleSignupBlur('email') : undefined}
                    aria-invalid={isSignUp && Boolean(signupErrors.email)}
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                    autoComplete="email"
                    required
                  />
                  {isSignUp && signupErrors.email && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.email}</p>}
                </div>

                {!isForgotPassword && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        {passwordRecoveryRequired ? 'New Password' : 'Password *'}
                      </label>
                      {!isSignUp && !passwordRecoveryRequired && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsForgotPassword(true);
                            setErrorMsg('');
                          }}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder={passwordRecoveryRequired ? 'Enter new password' : '••••••••'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onBlur={isSignUp ? () => handleSignupBlur('password') : undefined}
                        aria-invalid={isSignUp && Boolean(signupErrors.password)}
                        className="w-full px-3.5 py-2.5 pr-16 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                        autoComplete={isSignUp ? 'new-password' : 'current-password'}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-3 text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {isSignUp && password && (
                      <div className="mt-2 space-y-1">
                        <div className="flex gap-1 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full flex-1 transition-all ${passwordStrength >= 1 ? (passwordStrength === 1 ? 'bg-rose-500' : passwordStrength <= 3 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-transparent'}`} />
                          <div className={`h-full flex-1 transition-all ${passwordStrength >= 2 ? (passwordStrength <= 3 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-transparent'}`} />
                          <div className={`h-full flex-1 transition-all ${passwordStrength >= 3 ? (passwordStrength <= 3 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-transparent'}`} />
                          <div className={`h-full flex-1 transition-all ${passwordStrength >= 4 ? 'bg-emerald-500' : 'bg-transparent'}`} />
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-500">
                          <span>Strength: <strong className={passwordStrength >= 4 ? 'text-emerald-600' : passwordStrength >= 2 ? 'text-amber-600' : 'text-rose-600'}>{passwordStrength === 4 ? 'Strong' : passwordStrength >= 2 ? 'Medium' : 'Weak'}</strong></span>
                          <span>(Min 8 chars, 1 uppercase, 1 lowercase, 1 number)</span>
                        </div>
                      </div>
                    )}
                    {isSignUp && signupErrors.password && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.password}</p>}
                  </div>
                )}

                {(isSignUp || passwordRecoveryRequired) && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      {passwordRecoveryRequired ? 'Confirm New Password' : 'Confirm Password *'}
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder={passwordRecoveryRequired ? 'Confirm your new password' : 'Confirm your password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onBlur={() => {
                          if (isSignUp && !passwordRecoveryRequired) handleSignupBlur('confirmPassword');
                        }}
                        aria-invalid={isSignUp && !passwordRecoveryRequired && Boolean(signupErrors.confirmPassword)}
                        className="w-full px-3.5 py-2.5 pr-16 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((visible) => !visible)}
                        aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                        className="absolute inset-y-0 right-3 text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                      >
                        {showConfirmPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {isSignUp && !passwordRecoveryRequired && signupErrors.confirmPassword && (
                      <p className="mt-1 text-[11px] text-rose-600">{signupErrors.confirmPassword}</p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 cursor-pointer transition"
                >
                  {loading
                    ? 'Please wait...'
                    : passwordRecoveryRequired
                    ? 'Update Password'
                    : isForgotPassword
                    ? 'Send Password Reset Link'
                    : isSignUp
                    ? 'Create Free Account'
                    : 'Login to Pharmacy'}
                </button>
              </form>
            )}

            {/* Divider */}
            {!isForgotPassword && !passwordRecoveryRequired && !signupEmailVerificationSent && (
              <div className="relative my-4 flex items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">OR</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>
            )}

            {/* Google OAuth Button */}
            {!isForgotPassword && !passwordRecoveryRequired && !signupEmailVerificationSent && (
              isSupabaseConfigured ? (
                <button
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2.5 rounded-xl text-xs shadow-sm cursor-pointer transition mb-4"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  Continue with Google
                </button>
              ) : null
            )}

            {/* Quick Demo Access */}
            {(demoCustomerEnabled || demoAdminEnabled) && !isForgotPassword && !passwordRecoveryRequired && !signupEmailVerificationSent && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 text-center">Instant Demo Access</p>
                <div className={`grid grid-cols-1 ${demoCustomerEnabled && demoAdminEnabled ? 'sm:grid-cols-2' : ''} gap-2`}>
                  {demoCustomerEnabled && (
                    <button
                      onClick={handleDemoCustomer}
                      disabled={loading}
                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-1.5 px-2 rounded-xl text-[11px] cursor-pointer transition text-center"
                    >
                      🛒 Demo Customer
                    </button>
                  )}
                  {demoAdminEnabled && (
                    <button
                      onClick={handleDemoAdmin}
                      disabled={loading}
                      className="bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold py-1.5 px-2 rounded-xl text-[11px] cursor-pointer transition text-center disabled:opacity-50"
                    >
                      🛡️ Demo Admin
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Toggle Sign Up / Login */}
            {!passwordRecoveryRequired && !signupEmailVerificationSent && (
              <div className="mt-4 text-center">
                <p className="text-xs text-slate-500 font-medium">
                  {isForgotPassword
                    ? 'Remember your password?'
                    : isSignUp
                    ? 'Already have an account?'
                    : "Don't have an account?"}{' '}
                  <button
                    onClick={() => {
                      setIsForgotPassword(false);
                      setResetEmailSent(false);
                      setIsSignUp(isForgotPassword ? false : !isSignUp);
                      setErrorMsg('');
                      setSignupErrors({});
                    }}
                    className="text-blue-600 font-extrabold hover:underline cursor-pointer"
                  >
                    {isForgotPassword ? 'Login here' : isSignUp ? 'Login here' : 'Sign Up'}
                  </button>
                </p>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
