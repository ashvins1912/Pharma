import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import apiClient from '../api/apiClient';
import { env } from '../config/env';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('customer');
  const [loading, setLoading] = useState(true);
  const [passwordRecoveryRequired, setPasswordRecoveryRequired] = useState(false);

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
      // Hydrate authoritative profile from /api/v1/auth/me
      apiClient.get('/api/v1/auth/me')
        .then(res => {
          if (res.data?.data?.user) {
            const authoritative = res.data.data.user;
            setUser(prev => prev ? { ...prev, ...authoritative } : prev);
            if (authoritative.role) setRole(authoritative.role);
          }
        })
        .catch(() => {});
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
        await apiClient.get('/api/auth/csrf').catch(() => {});

        // Check active session via HttpOnly cookie
        const { data } = await apiClient.get('/api/auth/session');
        const sessionUser = data?.user || (data?.id ? data : null);
        if (mounted && sessionUser) {
          syncSession({ user: sessionUser }, sessionUser);
          setMfaEnabled(Boolean(data.mfaEnabled));
          setAal(data.aal || 'aal1');
        }
      } catch (error) {
        // A cached user object is not proof of a valid session. Protected UI
        // remains unauthenticated until the server validates the session.
        if (mounted) {
          syncSession(null);
          if (error.status === 401) {
            localStorage.removeItem('demo_session');
            localStorage.removeItem('demo_auth_token');
            if (supabase) void supabase.auth.signOut({ scope: 'local' }).catch(signOutError => {
              console.warn('Could not clear expired local Supabase session.', { name: signOutError.name, status: signOutError.status });
            });
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    initAuth();

    // Supabase Auth listener if configured
    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, supaSession) => {
        if (event === 'PASSWORD_RECOVERY') {
          setPasswordRecoveryRequired(true);
        }
        if (!mounted) return;
        if (supaSession) syncSession(supaSession);
        else if (event === 'SIGNED_OUT') syncSession(null);
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
      if (supabase) {
        void supabase.auth.signOut({ scope: 'local' }).then(({ error }) => {
          if (error) console.warn('Could not clear expired local Supabase session.', { name: error.name, status: error.status });
        });
      }
    };
    window.addEventListener('ashvin:authentication-required', handleAuthenticationRequired);
    return () => window.removeEventListener('ashvin:authentication-required', handleAuthenticationRequired);
  }, []);

  /**
   * Step 1: Login with Email & Password
   * Detects if Zero-Cost TOTP MFA is enrolled.
   */
  const loginWithEmail = async (email, password) => {
    const res = await apiClient.post('/api/auth/login', { email, password });
    const data = res.data;

    if (data.mfaRequired) {
      setMfaRequired(true);
      setMfaChallenge({
        challengeToken: data.challengeToken,
        factorId: data.factorId,
        email: data.email
      });
      return { mfaRequired: true, email: data.email };
    }

    syncSession({ user: data.user }, data.user);
    setAal(data.aal || 'aal1');
    setMfaRequired(false);
    setMfaChallenge(null);
    return { success: true, user: data.user };
  };

  const loginWithGoogle = async () => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Google sign-in is unavailable until Supabase is configured.');
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: env.VITE_FRONTEND_URL || window.location.origin }
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

    const { data } = await apiClient.post('/api/auth/mfa/verify', {
      code,
      challengeToken: mfaChallenge.challengeToken
    });

    syncSession({ user: data.user }, data.user);
    setAal('aal2');
    setMfaEnabled(true);
    setMfaRequired(false);
    setMfaChallenge(null);
    return data;
  };

  const cancelMfa = () => {
    setMfaRequired(false);
    setMfaChallenge(null);
  };

  /**
   * MFA Enrollment Methods
   */
  const enrollMfa = async () => {
    const { data } = await apiClient.post('/api/auth/mfa/enroll');
    return data;
  };

  const confirmMfaEnroll = async (code) => {
    const { data } = await apiClient.post('/api/auth/mfa/confirm-enroll', { code });
    setMfaEnabled(true);
    setAal('aal2');
    return data;
  };

  const disableMfa = async () => {
    const { data } = await apiClient.post('/api/auth/mfa/mfa-disable');
    setMfaEnabled(false);
    setAal('aal1');
    return data;
  };

  const signUpWithEmail = async (param1, param2, param3 = '', param4 = '', param5 = '', param6 = '', param7 = '') => {
    let payload = {};
    if (typeof param1 === 'object' && param1 !== null) {
      payload = {
        email: param1.email,
        password: param1.password,
        firstName: param1.firstName || '',
        lastName: param1.lastName || '',
        name: param1.name || `${param1.firstName || ''} ${param1.lastName || ''}`.trim(),
        dateOfBirth: param1.dateOfBirth,
        mobileNumber: param1.mobileNumber || param1.mobile || '',
        mobile: param1.mobileNumber || param1.mobile || ''
      };
    } else {
      payload = {
        email: param1,
        password: param2,
        name: param3,
        mobile: param4,
        mobileNumber: param4,
        firstName: param5,
        lastName: param6,
        dateOfBirth: param7 || null
      };
    }

    const { data } = await apiClient.post('/api/v1/auth/signup', payload);
    if (data?.data?.user && data?.data?.user?.accountStatus === 'ACTIVE') {
      syncSession({ user: data.data.user }, data.data.user);
    } else if (data?.user && data?.user?.accountStatus === 'ACTIVE') {
      syncSession({ user: data.user }, data.user);
    }
    return data;
  };

  const completeProfileOnboarding = async ({ firstName, lastName, dateOfBirth, mobileNumber }) => {
    const { data } = await apiClient.put('/api/v1/profile/onboarding', {
      firstName,
      lastName,
      dateOfBirth,
      mobileNumber
    });
    const updatedUser = data?.data?.user || data?.user;
    if (updatedUser) {
      syncSession({ user: updatedUser }, updatedUser);
    }
    return data;
  };

  const resendVerificationEmail = async (email) => {
    const { data } = await apiClient.post('/api/v1/auth/resend-verification', { email });
    return data;
  };

  const activateAccount = async (token) => {
    const { data } = await apiClient.post('/api/v1/auth/activate', { token });
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
    setMfaRequired(false);
    setMfaChallenge(null);
    window.dispatchEvent(new CustomEvent('ashvin:logout-complete'));
    try {
      await apiClient.post('/api/auth/logout');
    } catch (error) {
      console.warn('Server logout request failed; local logout was completed.', {
        code: error.code,
        status: error.status,
        requestId: error.requestId
      });
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
    if (!isSupabaseConfigured) {
      throw new Error('Password reset is unavailable until Supabase is configured.');
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: env.VITE_FRONTEND_URL || window.location.origin
    });
    if (error) throw error;
  };

  const updatePassword = async (password) => {
    if (!isSupabaseConfigured) {
      throw new Error('Password reset is unavailable until Supabase is configured.');
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setPasswordRecoveryRequired(false);
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
        loginWithGoogle,
        loginWithEmail,
        verifyTotp,
        cancelMfa,
        enrollMfa,
        confirmMfaEnroll,
        disableMfa,
        signUpWithEmail,
        completeProfileOnboarding,
        resendVerificationEmail,
        activateAccount,
        sendPasswordResetEmail,
        updatePassword,
        loginDemoCustomer,
        loginDemoAdmin,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
