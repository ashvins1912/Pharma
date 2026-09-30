import React, { createContext, useContext, useState, useEffect } from 'react';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import apiClient from '../api/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('customer'); // 'customer' | 'admin'
  const [loading, setLoading] = useState(true);
  const [passwordRecoveryRequired, setPasswordRecoveryRequired] = useState(false);

  // Zero-Cost TOTP Multi-Factor Authentication State
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState(null); // { challengeToken, factorId, email }
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [aal, setAal] = useState('aal1'); // 'aal1' (Single Factor) | 'aal2' (MFA Verified)

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
      setRole(userRole === 'admin' ? 'admin' : 'customer');
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
        if (mounted && data?.user) {
          syncSession({ user: data.user }, data.user);
          setMfaEnabled(Boolean(data.mfaEnabled));
          setAal(data.aal || 'aal1');
        }
      } catch {
        // Fallback to local demo session if available
        const savedDemo = localStorage.getItem('demo_session');
        if (savedDemo && mounted) {
          try {
            const parsed = JSON.parse(savedDemo);
            if (parsed?.access_token === 'demo-customer-token') {
              syncSession(parsed, parsed.user);
            }
          } catch {}
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
        if (supaSession && mounted) {
          syncSession(supaSession);
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

  const signUpWithEmail = async (email, password, name = '', mobile = '') => {
    const { data } = await apiClient.post('/api/auth/signup', {
      email,
      password,
      name,
      mobile
    });
    if (data.user) {
      syncSession({ user: data.user }, data.user);
    }
    return data;
  };

  const loginDemoCustomer = (email = 'customer@ashvinpharma.com', name = 'Ashvin Singh') => {
    const demo = {
      access_token: 'demo-customer-token',
      user: {
        id: 'demo-customer-id',
        email,
        role: 'customer',
        user_metadata: {
          name,
          role: 'customer',
          mobile: '+91 95899 16475'
        }
      }
    };
    localStorage.setItem('demo_session', JSON.stringify(demo));
    syncSession(demo, demo.user);
    setMfaRequired(false);
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
    try {
      await apiClient.post('/api/auth/logout');
      if (isSupabaseConfigured) {
        await supabase.auth.signOut().catch(() => {});
      }
    } catch {}
    localStorage.removeItem('demo_session');
    localStorage.removeItem('demo_auth_token');
    syncSession(null);
  };

  const sendPasswordResetEmail = async (email) => {
    if (!isSupabaseConfigured) {
      throw new Error('Password reset is unavailable until Supabase is configured.');
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
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
        isAdmin: role === 'admin',
        loading,
        mfaRequired,
        mfaChallenge,
        mfaEnabled,
        aal,
        passwordRecoveryRequired,
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
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
