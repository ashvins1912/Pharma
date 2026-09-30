import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { isSupabaseConfigured } from '../supabaseClient';

const signupFields = ['name', 'mobile', 'email', 'password', 'confirmPassword'];

function validateSignupField(field, values) {
  switch (field) {
    case 'name':
      return values.name.trim().length < 2 ? 'Full name must be at least 2 characters.' : '';
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [signupErrors, setSignupErrors] = useState({});

  const resetForm = () => {
    setIsSignUp(false);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setTotpCode('');
    setIsForgotPassword(false);
    setResetEmailSent(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setName('');
    setMobile('');
    setLoading(false);
    setErrorMsg('');
    setSignupErrors({});
  };

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen]);

  if (!isOpen) return null;

  const getSignupValues = () => ({ name, mobile, email, password, confirmPassword });
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

  const handleClose = () => {
    cancelMfa();
    resetForm();
    onClose();
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
        handleClose();
      } else if (isSignUp) {
        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match.');
          setLoading(false);
          return;
        }
        await signUpWithEmail(email, password, name, mobile);
        addToast('Account created successfully!', 'success');
        handleClose();
      } else {
        // Step 1: Submit primary credentials
        const result = await loginWithEmail(email, password);
        if (result.mfaRequired) {
          addToast('Two-factor authentication code required.', 'info');
          // Automatically transitions to Step 2 (TOTP verification UI)
        } else {
          addToast('Signed in successfully!', 'success');
          handleClose();
        }
      }
    } catch (err) {
      setErrorMsg(err.message || 'Authentication failed. Please verify credentials.');
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
      handleClose();
    } catch (err) {
      setErrorMsg(err.message || 'Invalid 6-digit code. Please verify in your authenticator app.');
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
      setErrorMsg(err.message || 'Could not send the password reset email.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await loginWithGoogle();
      handleClose();
    } catch (err) {
      setErrorMsg(err.message || 'Google OAuth failed.');
      setLoading(false);
    }
  };

  const handleDemoCustomer = () => {
    loginDemoCustomer();
    addToast('Logged in as Demo Customer!', 'success');
    handleClose();
  };

  const handleDemoAdmin = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      await loginDemoAdmin();
      addToast('Logged in as Demo Admin!', 'success');
      handleClose();
    } catch (err) {
      setErrorMsg(err.message || 'Demo admin sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden">
        
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
        >
          ✕
        </button>

        {/* Shop Logo & Title */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-600 text-white flex items-center justify-center text-3xl shadow-md shadow-blue-500/25 mb-3">
            {mfaRequired ? '🛡️' : '⚕️'}
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {mfaRequired ? 'Two-Factor Authentication' : 'Welcome to Ashvin Pharmacy'}
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            {mfaRequired
              ? `Enter the 6-digit TOTP code for ${mfaChallenge?.email || 'your account'}`
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

        {/* STEP 2: TOTP MULTI-FACTOR AUTHENTICATION CHALLENGE SCREEN */}
        {mfaRequired ? (
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
                    // Auto-submit on 6th digit
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
          /* STEP 1: STANDARD AUTHENTICATION & REGISTRATION SCREEN */
          <>
            {resetEmailSent && isForgotPassword && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                If an account exists for {email}, a password reset link has been sent. Check your inbox and follow the link to choose a new password.
              </div>
            )}

            {!resetEmailSent && (
              <form onSubmit={isForgotPassword ? handleSendPasswordReset : handleSubmit} className="space-y-3.5">
                {import.meta.env.DEV && import.meta.env.VITE_DEMO_ADMIN_ENABLED !== 'false' && !isSignUp && !isForgotPassword && !passwordRecoveryRequired && (
                  <div className="rounded-xl border border-purple-200 bg-purple-50 p-3 text-[11px] text-purple-800">
                    Local demo admin: sign in with email <span className="font-bold">ashvinsingh25@gmail.com</span> and password <span className="font-bold">Admin@123</span>, or click <span className="font-bold">🛡️ Demo Admin</span> below.
                  </div>
                )}

                {isSignUp && !passwordRecoveryRequired && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Ashvin Singh"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => handleSignupBlur('name')}
                      aria-invalid={Boolean(signupErrors.name)}
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                      required
                    />
                    {signupErrors.name && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.name}</p>}
                  </div>
                )}

                {isSignUp && !passwordRecoveryRequired && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Mobile Number (Encrypted with AES-256-GCM)
                    </label>
                    <input
                      type="tel"
                      placeholder="e.g. +91 95899 16475"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      onBlur={() => handleSignupBlur('mobile')}
                      aria-invalid={Boolean(signupErrors.mobile)}
                      className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition"
                      required
                    />
                    {signupErrors.mobile && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.mobile}</p>}
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Email Address
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
                        {passwordRecoveryRequired ? 'New Password' : 'Password'}
                      </label>
                      {!isSignUp && !passwordRecoveryRequired && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsForgotPassword(true);
                            setErrorMsg('');
                          }}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-800"
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
                        className="absolute inset-y-0 right-3 text-[11px] font-bold text-blue-600 hover:text-blue-800"
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {isSignUp && signupErrors.password && <p className="mt-1 text-[11px] text-rose-600">{signupErrors.password}</p>}
                  </div>
                )}

                {(isSignUp || passwordRecoveryRequired) && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      {passwordRecoveryRequired ? 'Confirm New Password' : 'Retype Password'}
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder={passwordRecoveryRequired ? 'Confirm your new password' : 'Retype your password'}
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
                        className="absolute inset-y-0 right-3 text-[11px] font-bold text-blue-600 hover:text-blue-800"
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
            {!isForgotPassword && !passwordRecoveryRequired && (
              <div className="relative my-4 flex items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">OR</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>
            )}

            {/* Google OAuth Button */}
            {!isForgotPassword && !passwordRecoveryRequired && (
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
            {import.meta.env.DEV && import.meta.env.VITE_INSTANT_DEMO_ACCESS_ENABLED !== 'false' && !isForgotPassword && !passwordRecoveryRequired && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 text-center">Instant Demo Access</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={handleDemoCustomer}
                    disabled={loading}
                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-1.5 px-2 rounded-xl text-[11px] cursor-pointer transition text-center"
                  >
                    🛒 Demo Customer
                  </button>
                  <button
                    onClick={handleDemoAdmin}
                    disabled={loading}
                    className="bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold py-1.5 px-2 rounded-xl text-[11px] cursor-pointer transition text-center disabled:opacity-50"
                  >
                    🛡️ Demo Admin
                  </button>
                </div>
              </div>
            )}

            {/* Toggle Sign Up / Login */}
            {!passwordRecoveryRequired && (
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
