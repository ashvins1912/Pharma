import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import { env } from '../config/env.ts';
import apiClient, { setAuthorizationCapabilities, clearAuthorizationCapabilities, setApplicationSessionAuthenticated, getAuthMe } from '../api/apiClient';
import GoogleProfileOnboarding from '../components/auth/GoogleProfileOnboarding';
import { useActionLoading, LOADING_ACTIONS } from './LoadingContext';

const AuthContext = createContext(null);

// These capabilities identify staff workspaces, rather than customer self-service
// access (for example, customers can read their own orders and medicine requests).

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('customer');
  const [permissions, setPermissions] = useState([]);
  const [revokedPermissions, setRevokedPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authTransitionLoading, setAuthTransitionLoading] = useState(false);
  const [passwordRecoveryRequired, setPasswordRecoveryRequired] = useState(false);
  const [profileCompletionRequired, setProfileCompletionRequired] = useState(false);
  // Zero-Cost TOTP Multi-Factor Authentication State
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState(null); // { challengeToken, factorId, email }
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [aal, setAal] = useState('aal1'); // 'aal1' (Single Factor) | 'aal2' (MFA Verified)
  const logoutInProgress = useRef(false);
  const googleExchangePromiseRef = useRef(null);
  const googleSignInInProgressRef = useRef(false);
  const { runAction } = useActionLoading();

  // A user object alone is not enough to authorize application API calls.
  // Google first-time users receive a restricted PROFILE_INCOMPLETE token.
  // Only a completed ACTIVE Pharma profile is considered fully authenticated.
  const isFullyAuthenticated = Boolean(
    !loading &&
    !profileCompletionRequired &&
    !mfaRequired &&
    user?.id &&
    user?.profileCompleted !== false &&
    String(user?.accountStatus || 'ACTIVE').toUpperCase() === 'ACTIVE'
  );


  // Synchronize user and role
  const syncSession = (currSession, userData = null) => {
    setApplicationSessionAuthenticated(Boolean(currSession && userData?.id));
    setSession(currSession);
    const resolvedUser = userData || currSession?.user;
    if (resolvedUser) {
      setUser(resolvedUser);
      const userRole =
        resolvedUser.app_metadata?.role ||
        resolvedUser.role ||
        'customer';
      setRole(userRole);
      const resolvedPermissions = Array.isArray(resolvedUser.permissions) ? resolvedUser.permissions : [];
      const resolvedRevocations = Array.isArray(resolvedUser.revokedPermissions)
        ? resolvedUser.revokedPermissions
        : (Array.isArray(resolvedUser.app_metadata?.revokedPermissions)
          ? resolvedUser.app_metadata.revokedPermissions
          : (Array.isArray(resolvedUser.accessRevokes) ? resolvedUser.accessRevokes : []));
      setPermissions(resolvedPermissions);
      setRevokedPermissions(resolvedRevocations);
      setAuthorizationCapabilities({
        userId: resolvedUser.id,
        role: userRole,
        permissions: resolvedPermissions,
        revokedPermissions: resolvedRevocations
      });
    } else {
      setUser(null);
      setRole('customer');
      setPermissions([]);
      setRevokedPermissions([]);
      clearAuthorizationCapabilities();
      setMfaEnabled(false);
      setAal('aal1');
    }
  };

  // Check HttpOnly session on initial load and obtain CSRF token
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        // Do not make CSRF bootstrap part of anonymous landing. Login,
        // Google exchange, refresh and other session-establishing responses set
        // the XSRF-TOKEN cookie themselves. This keeps initial page hydration
        // independent of a backend CSRF request.
        // Do not probe /auth/me while an upstream Google OAuth session is
        // waiting to be exchanged or while the account is in PROFILE_INCOMPLETE.
        // The Google exchange returns the Pharma user and establishes the
        // restricted onboarding session; protected profile APIs start only
        // after profile completion.
        let upstreamGoogleSession = null;
        if (isSupabaseConfigured && supabase) {
          try {
            const { data: supaData } = await supabase.auth.getSession();
            upstreamGoogleSession = supaData?.session || null;
          } catch {
            upstreamGoogleSession = null;
          }
        }

        if (upstreamGoogleSession) {
          const result = await exchangeGoogleSession(upstreamGoogleSession);
          const sessionUser = result?.user || null;
          if (mounted && sessionUser && sessionUser.profileCompleted !== false
              && String(sessionUser.accountStatus || 'ACTIVE').toUpperCase() === 'ACTIVE') {
            setMfaEnabled(Boolean(result?.mfaEnabled));
            setAal(result?.aal || 'aal1');
          }
        } else {
          const probe = await getAuthMe({ allowAnonymous: true });
          const data = probe?.data || null;
          const sessionUser = data?.user || (data?.id ? data : null);
          if (mounted && sessionUser && sessionUser.profileCompleted !== false
              && String(sessionUser.accountStatus || 'ACTIVE').toUpperCase() === 'ACTIVE') {
            syncSession({ user: sessionUser }, sessionUser);
            setMfaEnabled(Boolean(data.mfaEnabled));
            setAal(data.aal || 'aal1');
          }
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
        if (mounted) {
          setLoading(false);
          setAuthTransitionLoading(false);
        }
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
          const provider = supaSession.user?.app_metadata?.provider
            || supaSession.user?.identities?.[0]?.provider;

          if (provider !== 'google') {
            if (event !== 'INITIAL_SESSION') {
              // Supabase is only the upstream Google identity broker.
              // Do not call Supabase signOut here: it performs a network logout
              // request which can return 403 when the upstream session is already
              // expired/revoked. Clear the local broker copy instead.
              clearSupabaseLocalSession();
            }
            return;
          }

          // Supabase auth callbacks must not await another Supabase auth
          // operation. Defer exchange and cleanup until the callback returns.
          setTimeout(() => {
            void (async () => {
              try {
                await exchangeGoogleSession(supaSession);
                // Keep the upstream Google session available while the user
                // completes the restricted Pharma onboarding flow. This lets
                // us re-establish the onboarding cookie if a proxy drops the
                // Set-Cookie header from the exchange response.
              } catch (error) {
                console.error('Google identity exchange failed.', error);
                syncSession(null);
              }
            })();
          }, 0);
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

  // Keep long-lived admin/tenant workspaces alive without weakening access control.
  // The access JWT is short-lived; the HttpOnly refresh cookie is rotated silently
  // while the authenticated app is open or when a backgrounded tab becomes visible.
  useEffect(() => {
    if (!isFullyAuthenticated) return undefined;

    let stopped = false;
    let refreshInFlight = null;

    const refreshSession = async () => {
      if (stopped || refreshInFlight) return refreshInFlight;
      refreshInFlight = apiClient.post('/api/v1/auth/refresh')
        .then(({ data }) => {
          if (stopped) return;
          const refreshedUser = data?.data?.user || data?.user;
          if (refreshedUser?.id) {
            const refreshedRole = refreshedUser.app_metadata?.role || refreshedUser.role || role;
            const refreshedPermissions = Array.isArray(refreshedUser.permissions) ? refreshedUser.permissions : [];
            const refreshedRevocations = Array.isArray(refreshedUser.revokedPermissions)
              ? refreshedUser.revokedPermissions
              : (Array.isArray(refreshedUser.app_metadata?.revokedPermissions) ? refreshedUser.app_metadata.revokedPermissions : []);
            setUser(previous => previous?.id === refreshedUser.id ? { ...previous, ...refreshedUser } : refreshedUser);
            setRole(refreshedRole);
            setPermissions(refreshedPermissions);
            setRevokedPermissions(refreshedRevocations);
            setAuthorizationCapabilities({
              userId: refreshedUser.id,
              role: refreshedRole,
              permissions: refreshedPermissions,
              revokedPermissions: refreshedRevocations
            });
          }
        })
        .catch(() => {
          // Do not force logout from a background refresh failure. The next
          // protected request will perform the same single retry path.
        })
        .finally(() => {
          refreshInFlight = null;
        });
      return refreshInFlight;
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshSession();
    };

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSession();
    }, 10 * 60 * 1000);

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isFullyAuthenticated, role]);

  useEffect(() => {
    const handleAuthenticationRequired = () => {
      localStorage.removeItem('demo_session');
      localStorage.removeItem('demo_auth_token');
      syncSession(null);
      // Pharma owns the application session. Supabase is only the upstream
      // Google identity broker, so local broker cleanup must never make an
      // authentication-required event issue a second remote logout request.
      clearSupabaseLocalSession();
    };
    window.addEventListener('ashvin:authentication-required', handleAuthenticationRequired);
    return () => window.removeEventListener('ashvin:authentication-required', handleAuthenticationRequired);
  }, []);

  /**
   * Step 1: Login with Email & Password
   * Detects if Zero-Cost TOTP MFA is enrolled.
   */
  const loginWithEmail = async (email, password) => runAction(LOADING_ACTIONS.SIGN_IN, async () => {
    setAuthTransitionLoading(true);
    try {
    // Email/password login is a first-party platform session. Clear any old
    // browser-only Supabase session first so it cannot compete with this login.
    // Remove any stale upstream Google broker session locally. Do not call
    // Supabase signOut because the broker session may already be expired and
    // the remote logout endpoint can legitimately return 403.
    clearSupabaseLocalSession();
    const res = await apiClient.post('/api/v1/auth/login', { email, password });
    const data = res.data?.data || res.data;

    if (data.mfaRequired) {
      setMfaRequired(true);
      setMfaChallenge({
        challengeToken: data.challengeToken,
        factorId: data.factorId,
        email: data.email
      });
      setAuthTransitionLoading(false);
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
    setAuthTransitionLoading(false);
    return { success: true, user: data.user };
    } catch (error) {
      setAuthTransitionLoading(false);
      throw error;
    }
  });

  const loginWithGoogle = async () => {
    if (googleSignInInProgressRef.current) return { skipped: true };
    googleSignInInProgressRef.current = true;
    setAuthTransitionLoading(true);

    try {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Google sign-in is unavailable until Supabase is configured.');
      }

      // Clear any stale broker session locally before starting a new OAuth flow.
      clearSupabaseLocalSession();

      // In production always return to the actual storefront host. A stale
      // VITE_FRONTEND_URL value (for example localhost or an API host) must not
      // send the OAuth callback away from the running SPA.
      const redirectTo = import.meta.env.PROD
        ? window.location.origin
        : (env.VITE_FRONTEND_URL || window.location.origin);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account'
          }
        }
      });
      if (error) throw error;
      return { redirecting: true };
    } catch (error) {
      // Supabase can reject before it initiates a browser redirect (bad config,
      // blocked request, or provider error). Never leave the whole app in its
      // transition screen or lock the Google button after such a failure.
      googleSignInInProgressRef.current = false;
      setAuthTransitionLoading(false);
      throw error;
    }
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

  const updateProfile = async (profileData) => {
    const { data } = await apiClient.put('/api/v1/profile/me', profileData);
    const result = data?.data || data;
    const updatedUser = result?.user || result;
    if (updatedUser?.id) syncSession({ user: updatedUser }, updatedUser);
    return result;
  };

  const signUpWithEmail = async (email, password, confirmPassword = '', name = '', mobile = '', firstName = '', lastName = '', dateOfBirth = '', gender = '') => {
    const { data } = await apiClient.post('/api/v1/auth/signup', {
      email,
      password,
      confirmPassword,
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

  const verifyEmailCode = async (email, code) => {
    const { data } = await apiClient.post('/api/v1/auth/verify-email-code', { email, code });
    const result = data?.data || data;
    if (result?.user) {
      syncSession({ user: result.user }, result.user);
    }
    setProfileCompletionRequired(Boolean(result?.requiresProfileCompletion || result?.code === 'PROFILE_INCOMPLETE'));
    setMfaRequired(false);
    setMfaChallenge(null);
    return result;
  };

  const resendVerificationEmail = async (email) => {
    const { data } = await apiClient.post('/api/v1/auth/resend-verification', { email });
    return data?.data || data;
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
      await runAction(LOADING_ACTIONS.SIGN_OUT, async () => {
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
        clearSupabaseLocalSession();
      });
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

  const clearSupabaseLocalSession = () => {
    if (!isSupabaseConfigured || !supabase || typeof window === 'undefined') return;
    // Supabase is only the upstream Google identity broker in Pharma. Once
    // the identity has been exchanged, the Pharma HttpOnly cookie is the
    // application session. Remove the broker's browser copy without making a
    // second logout API request that can legitimately return 403 when the
    // upstream session is already gone.
    try {
      const projectRef = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
      window.localStorage.removeItem(`sb-${projectRef}-auth-token`);
    } catch {
      // Local cleanup is best-effort; Pharma auth remains authoritative.
    }
  };

  const exchangeGoogleSession = async (supaSession) => {
    if (!supaSession?.access_token) throw new Error('Google sign-in session is unavailable.');

    // The initial auth hydration and Supabase onAuthStateChange can fire for
    // the same OAuth callback. Share one exchange promise so we never create
    // two Pharma sessions or race user/profile state updates.
    if (googleExchangePromiseRef.current) return googleExchangePromiseRef.current;

    googleExchangePromiseRef.current = (async () => {
      try {
        const { data } = await apiClient.post('/api/v1/auth/google', {
          supabaseAccessToken: supaSession.access_token
        });
        const result = data?.data || data;
        syncSession({ user: result?.user }, result?.user);
        setProfileCompletionRequired(Boolean(result?.requiresProfileCompletion || result?.code === 'PROFILE_INCOMPLETE'));
        setAuthTransitionLoading(false);
        return result;
      } catch (error) {
        setAuthTransitionLoading(false);
        throw error;
      }
    })().finally(() => {
      googleExchangePromiseRef.current = null;
    });

    return googleExchangePromiseRef.current;
  };

  const completeGoogleProfile = async (profileData) => {
    let result;
    try {
      // Ensure the restricted Pharma onboarding cookie is freshly established
      // before profile completion. This prevents a lost/expired HttpOnly
      // onboarding cookie from producing a 401 on the first PUT.
      if (supabase) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.access_token) {
          await exchangeGoogleSession(sessionData.session);
        }
      }
      const { data } = await apiClient.put('/api/v1/auth/complete-profile', profileData);
      result = data?.data || data;
    } catch (error) {
      // If a hosting proxy dropped the Set-Cookie from the Google exchange,
      // recover the restricted onboarding session from the still-active
      // upstream Google session and retry exactly once.
      if (Number(error?.status) !== 401 || !supabase) throw error;
      const { data: sessionData } = await supabase.auth.getSession();
      const supaSession = sessionData?.session;
      if (!supaSession?.access_token) throw error;
      await exchangeGoogleSession(supaSession);
      const { data } = await apiClient.put('/api/v1/auth/complete-profile', profileData);
      result = data?.data || data;
    }

    const completedUser = result?.user || result;
    setProfileCompletionRequired(false);
    syncSession({ user: completedUser }, completedUser);
    clearSupabaseLocalSession();

    // Profile completion is the first point at which the application should
    // re-hydrate the canonical Pharma session from /auth/me.
    try {
      const { data } = await apiClient.get('/api/v1/auth/me');
      const sessionUser = data?.user || (data?.id ? data : null);
      if (sessionUser) {
        syncSession({ user: sessionUser }, sessionUser);
        setMfaEnabled(Boolean(data?.mfaEnabled));
        setAal(data?.aal || 'aal1');
      }
    } catch (error) {
      console.warn('Completed profile but could not refresh Pharma session profile.', {
        code: error?.code,
        status: error?.status
      });
    }
  };

  const hasPermission = useCallback((permission) => {
    if (!permission || !user?.id) return false;

    // Explicit revocations are deny rules, including for users with wildcard
    // or platform-administrator grants.
    const revoked = [
      ...(Array.isArray(revokedPermissions) ? revokedPermissions : []),
      ...(Array.isArray(user.revokedPermissions) ? user.revokedPermissions : []),
      ...(Array.isArray(user.app_metadata?.revokedPermissions) ? user.app_metadata.revokedPermissions : []),
      ...(Array.isArray(user.accessRevokes) ? user.accessRevokes : [])
    ];
    if (revoked.includes(permission)
      || revoked.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)))) {
      return false;
    }

    const granted = Array.isArray(permissions) ? permissions : [];
    return granted.includes('*')
      || granted.includes(permission)
      || granted.some(item => item.endsWith('.*') && permission.startsWith(item.slice(0, -1)));
  }, [user, permissions, revokedPermissions]);

  const hasAnyPermission = useCallback((requiredPermissions = []) =>
    Array.isArray(requiredPermissions) && requiredPermissions.some(hasPermission),
  [hasPermission]);

  // Access to the operations shell requires at least one complete workspace
  // capability. Individual tab/action permissions are checked separately below.
  const canAccessOperations = Boolean(isFullyAuthenticated && (
    hasAnyPermission(['inventory.read', 'csquare.read', 'promotions.read', 'billing.read'])
    || (hasPermission('delivery.read') && hasPermission('delivery.manage'))
    || (hasPermission('orders.read') && hasPermission('orders.manage'))
    || (hasPermission('medicine_requests.read')
      && hasAnyPermission(['medicine_requests.pending_count', 'medicine_requests.manage', 'medicine_requests.proposal']))
    || (['SUPER_ADMIN', 'PLATFORM_SUPER_ADMIN', 'admin'].includes(role)
      && hasAnyPermission(['tenants.read', 'users.manage']))
  ));

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        permissions,
        revokedPermissions,
        hasPermission,
        hasAnyPermission,
        canAccessOperations,
        isAdmin: role === 'SUPER_ADMIN' || role === 'admin' || role === 'PLATFORM_SUPER_ADMIN' || role === 'TENANT_ADMIN' || role === 'TENANT_OWNER',
        isSuperAdmin: role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN' || role === 'admin',
        isPlatformSuperAdmin: role === 'SUPER_ADMIN' || role === 'PLATFORM_SUPER_ADMIN' || role === 'admin',
        isTenantAdmin: role === 'TENANT_ADMIN' || role === 'TENANT_OWNER',
        isPharmacyOrAdmin: canAccessOperations,
        tenantId: user?.tenantId || user?.app_metadata?.tenantId || null,
        scope: (role === 'SUPER_ADMIN' || role === 'admin' || role === 'PLATFORM_SUPER_ADMIN') ? 'PLATFORM' : ((user?.tenantId || user?.app_metadata?.tenantId) ? 'TENANT' : 'CUSTOMER'),
        loading,
        authTransitionLoading,
        mfaRequired,
        mfaChallenge,
        mfaEnabled,
        aal,
        passwordRecoveryRequired,
        profileCompletionRequired,
        isFullyAuthenticated,
        loginWithGoogle,
        loginWithEmail,
        verifyTotp,
        cancelMfa,
        enrollMfa,
        confirmMfaEnroll,
        disableMfa,
        signUpWithEmail,
        verifyEmailCode,
        resendVerificationEmail,
        sendPasswordResetEmail,
        updatePassword,
        updateProfile,
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