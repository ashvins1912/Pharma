import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import apiClient from '../api/apiClient';
import { env } from '../config/env';
import GoogleProfileOnboarding from '../components/auth/GoogleProfileOnboarding';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('customer');
  const [loading, setLoading] = useState(true);
  const [passwordRecoveryRequired, setPasswordRecoveryRequired] = useState(false);
  const [profileCompletionRequired, setProfileCompletionRequired] = useState(false);

  // Zero-Cost TOTP Multi-Factor Authentication State
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState(null); // { challengeToken, factorId, email }
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [aal, setAal] = useState('aal1'); // 'aal1' (Single Factor) | 'aal2' (MFA Verified)
  const logoutInProgress = useRef(false);

  // Synchronize user and role
  const syncSession = (currSession, userData = null) => {
    setSession(currSession);
    const resolvedUser = userData || currSession?.user;
    if (resolvedUser) {
      setUser(resolvedUser);
      const userRole =
        resolvedUser.app_metadata?.role ||
        resolvedUser.role ||
        'customer';
      setRole(userRole);
    } else {
      setUser(null);
      setRole('customer');
      setMfaEnabled(false);
      setAal('aal1');
    }
  };

  // Check HttpOnly session on initial load and obtain CSRF token
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        // Initialize anti-CSRF token
        await apiClient.get('/api/v1/auth/csrf').catch(() => {});

        // Check active session via HttpOnly cookie
        const { data } = await apiClient.get('/api/v1/auth/me');
        const sessionUser = data?.user || (data?.id ? data : null);
        if (mounted && sessionUser) {
          syncSession({ user: sessionUser }, sessionUser);
          setMfaEnabled(Boolean(data.mfaEnabled));
          setAal(data.aal || 'aal1');
        }
      } catch (error) {
        // Do not treat cached identity data as a valid authenticated session.
        if (mounted) {
          syncSession(null);
          localStorage.removeItem('demo_session');
          localStorage.removeItem('demo_auth_token');
          // Never clear the temporary Supabase OAuth session here. During the
          // Google redirect callback, /me can legitimately return 401 before
          // the Supabase session is exchanged for a Pharma session.
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (window.location.pathname === '/reset-password' && new URLSearchParams(window.location.search).get('token')) {
      setPasswordRecoveryRequired(true);
    }

    initAuth();

    // Supabase is retained only as the upstream Google identity broker.
    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, supaSession) => {
        if (!mounted) return;
        if (supaSession) {
          // Supabase is an upstream Google identity only. Exchange it once for
          // the first-party Pharma session, then immediately clear the local
          // Supabase browser session so it cannot become an API credential.
          void (async () => {
            try {
              const { data } = await apiClient.post('/api/v1/auth/google', {
                supabaseAccessToken: supaSession.access_token
              });
              const result = data?.data || data;
              syncSession({ user: result?.user }, result?.user);
              setProfileCompletionRequired(Boolean(result?.requiresProfileCompletion || result?.code === 'PROFILE_INCOMPLETE'));
              if (supabase) await supabase.auth.signOut({ scope: 'local' });
            } catch (error) {
              console.error('Google identity exchange failed.', error);
              syncSession(null);
            }
          })();
        } else if (event === 'SIGNED_OUT') {
          // Do not clear the first-party Pharma session just because the
          // temporary upstream Google session was removed after exchange.
        }
      });
      return () => {
        mounted = false;
        subscription?.unsubscribe();
      };
    }

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleAuthenticationRequired = () => {
      localStorage.removeItem('demo_session');
      localStorage.removeItem('demo_auth_token');
      syncSession(null);
      if (supabase) void supabase.auth.signOut({ scope: 'local' }).then(({ error }) => {
        if (error) console.warn('Could not clear expired local Supabase session.', { name: error.name, status: error.status });
      });
    };
    window.addEventListener('ashvin:authentication-required', handleAuthenticationRequired);
    return () => window.removeEventListener('ashvin:authentication-required', handleAuthenticationRequired);
  }, []);

  /**
   * Step 1: Login with Email & Password
   * Detects if Zero-Cost TOTP MFA is enrolled.
   */
  const loginWithEmail = async (email, password) => {
    // Email/password login is a first-party platform session. Clear any old
    // browser-only Supabase session first so it cannot compete with this login.
    if (supabase) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Backend authentication remains authoritative; do not block login.
      }
    }
    const res = await apiClient.post('/api/v1/auth/login', { email, password });
    const data = res.data?.data || res.data;

    if (data.mfaRequired) {
      setMfaRequired(true);
      setMfaChallenge({
        challengeToken: data.challengeToken,
        factorId: data.factorId,
        email: data.email
      });
      return { mfaRequired: true, email: data.email };
    }

    // Backend login establishes the secure HttpOnly platform session cookie.
    // Make that cookie the only API credential for this browser session so a
    // stale Supabase bearer token can never override the newly authenticated user.
    syncSession({ user: data.user }, data.user);
    setAal(data.aal || 'aal1');
    setMfaRequired(false);
    setMfaChallenge(null);
    setProfileCompletionRequired(Boolean(data?.requiresProfileCompletion || data?.code === 'PROFILE_INCOMPLETE'));
    return { success: true, user: data.user };
  };

  const loginWithGoogle = async () => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Google sign-in is unavailable until Supabase is configured.');
    }
    const redirectTo = env.VITE_FRONTEND_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'select_account' }
      }
    });
    if (error) throw error;
  };

  /**
   * Step 2: Verify 6-digit TOTP code
   * Completes authentication and upgrades session to AAL2
   */
  const verifyTotp = async (code) => {
    if (!mfaChallenge?.challengeToken) {
      throw new Error('MFA challenge session expired. Please sign in again.');
    }

    const { data } = await apiClient.post('/api/v1/auth/mfa/verify', {
      code,
      challengeToken: mfaChallenge.challengeToken
    });

    const result = data?.data || data;
    syncSession({ user: result.user }, result.user);
    setProfileCompletionRequired(false);
    setAal(result.aal || 'aal2');
    setMfaEnabled(true);
    setMfaRequired(false);
    setMfaChallenge(null);
    return result;
  };

  const cancelMfa = () => {
    setMfaRequired(false);
    setMfaChallenge(null);
  };

  /**
   * MFA Enrollment Methods
   */
  const enrollMfa = async () => {
    const { data } = await apiClient.post('/api/v1/auth/mfa/enroll');
    return data?.data || data;
  };

  const confirmMfaEnroll = async (code) => {
    const { data } = await apiClient.post('/api/v1/auth/mfa/confirm-enroll', { code });
    const result = data?.data || data;
    setMfaEnabled(true);
    setAal('aal2');
    return result;
  };

  const disableMfa = async () => {
    const { data } = await apiClient.post('/api/v1/auth/mfa/mfa-disable');
    const result = data?.data || data;
    setMfaEnabled(false);
    setAal('aal1');
    return result;
  };

  const signUpWithEmail = async (email, password, name = '', mobile = '', firstName = '', lastName = '', dateOfBirth = '', gender = '') => {
    const { data } = await apiClient.post('/api/v1/auth/signup', {
      email,
      password,
      name,
      firstName,
      lastName,
      mobile,
      dateOfBirth,
      gender
    });
    if (data?.data?.user && data?.data?.user?.status === 'ACTIVE') {
      syncSession({ user: data.data.user }, data.data.user);
    } else if (data?.user && data?.user?.status === 'ACTIVE') {
      syncSession({ user: data.user }, data.user);
    }
    return data;
  };

  const loginDemoCustomer = async () => {
    const { data } = await apiClient.post('/api/auth/demo-customer');
    const demo = { ...data, user: data.user };
    localStorage.setItem('demo_session', JSON.stringify(demo));
    syncSession(demo, demo.user);
    setMfaRequired(false);
    return demo.user;
  };

  const loginDemoAdmin = async () => {
    const { data } = await apiClient.post('/api/auth/demo-admin/instant');
    const demoSession = { ...data, user: data.user };
    localStorage.setItem('demo_session', JSON.stringify(demoSession));
    syncSession(demoSession, data.user);
    setMfaRequired(false);
    return data.user;
  };

  const logout = async () => {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;
    try {
    localStorage.removeItem('demo_session');
    localStorage.removeItem('demo_auth_token');
    syncSession(null);
    setProfileCompletionRequired(false);
    setMfaRequired(false);
    setMfaChallenge(null);
    window.dispatchEvent(new CustomEvent('ashvin:logout-complete'));
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch (error) {
      console.warn('Server logout request failed; local logout was completed.', { code: error.code, status: error.status, requestId: error.requestId });
    }
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) console.warn('Could not inspect Supabase session during logout.', { name: sessionError.name, status: sessionError.status });
        if (data?.session) {
          const { error } = await supabase.auth.signOut({ scope: 'local' });
          if (error) console.warn('Supabase local logout returned an error.', { name: error.name, status: error.status });
        }
      } catch (error) {
        console.warn('Supabase local logout failed.', { name: error.name, status: error.status });
      }
    }
    } finally {
      logoutInProgress.current = false;
    }
  };

  const sendPasswordResetEmail = async (email) => {
    await apiClient.post('/api/v1/auth/password/forgot', { email });
  };

  const updatePassword = async (password) => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) throw new Error('Password reset link is missing or expired.');
    const { data } = await apiClient.post('/api/v1/auth/password/reset', { token, password });
    const result = data?.data || data;
    if (result?.user) syncSession({ user: result.user }, result.user);
    setPasswordRecoveryRequired(false);
    window.history.replaceState({}, document.title, window.location.pathname);
    return result;
  };

  const completeGoogleProfile = (result) => {
    const completedUser = result?.user || result;
    setProfileCompletionRequired(false);
    syncSession({ user: completedUser }, completedUser);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        isAdmin: role === 'SUPER_ADMIN' || role === 'admin' || role === 'PLATFORM_SUPER_ADMIN' || role === 'TENANT_ADMIN' || role === 'TENANT_OWNER',
        isSuperAdmin: role === 'SUPER_ADMIN' || role === 'admin' || role === 'PLATFORM_SUPER_ADMIN',
        isTenantAdmin: role === 'TENANT_ADMIN' || role === 'TENANT_OWNER',
        isPharmacyOrAdmin: role === 'SUPER_ADMIN' || role === 'admin' || role === 'PLATFORM_SUPER_ADMIN' || role === 'TENANT_ADMIN' || role === 'TENANT_OWNER' || role === 'pharmacy' || role === 'PHARMACY_STAFF',
        tenantId: user?.tenantId || user?.app_metadata?.tenantId || null,
        scope: (role === 'SUPER_ADMIN' || role === 'admin' || role === 'PLATFORM_SUPER_ADMIN') ? 'PLATFORM' : ((user?.tenantId || user?.app_metadata?.tenantId) ? 'TENANT' : 'CUSTOMER'),
        loading,
        mfaRequired,
        mfaChallenge,
        mfaEnabled,
        aal,
        passwordRecoveryRequired,
        profileCompletionRequired,
        loginWithGoogle,
        loginWithEmail,
        verifyTotp,
        cancelMfa,
        enrollMfa,
        confirmMfaEnroll,
        disableMfa,
        signUpWithEmail,
        sendPasswordResetEmail,
        updatePassword,
        loginDemoCustomer,
        loginDemoAdmin,
        logout
      }}
    >
      {children}
      {profileCompletionRequired && user && (
        <GoogleProfileOnboarding
          user={user}
          onComplete={completeGoogleProfile}
          onLogout={logout}
        />
      )}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
