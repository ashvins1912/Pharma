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

  // Synchronize role and session state
  const syncSession = (currSession) => {
    setSession(currSession);
    if (currSession?.user) {
      setUser(currSession.user);
      const userRole =
        currSession.user.user_metadata?.role ||
        currSession.user.app_metadata?.role ||
        currSession.user.role ||
        'customer';
      setRole(userRole === 'admin' ? 'admin' : 'customer');
      if (currSession.access_token) {
        localStorage.setItem('demo_auth_token', currSession.access_token);
      }
    } else {
      setUser(null);
      setRole('customer');
      localStorage.removeItem('demo_auth_token');
    }
  };

  useEffect(() => {
    // Check for saved demo session first
    const savedDemo = localStorage.getItem('demo_session');
    if (savedDemo) {
      try {
        const parsed = JSON.parse(savedDemo);
        syncSession(parsed);
      } catch {}
    }

    if (!isSupabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    // Initialize Supabase session
    try {
      supabase.auth.getSession().then(({ data: { session: supaSession } }) => {
        if (supaSession) {
          syncSession(supaSession);
        }
      }).catch(() => {}).finally(() => setLoading(false));

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, supaSession) => {
        if (event === 'PASSWORD_RECOVERY') {
          setPasswordRecoveryRequired(true);
        }
        if (supaSession) {
          localStorage.removeItem('demo_session');
          syncSession(supaSession);
        } else if (!localStorage.getItem('demo_session')) {
          syncSession(null);
        }
      });

      return () => subscription?.unsubscribe();
    } catch {
      setLoading(false);
    }
  }, []);

  const loginWithGoogle = async () => {
    if (!isSupabaseConfigured) {
      throw new Error('Google sign-in is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then enable Google in your Supabase Auth providers.');
    }

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (err) {
      console.warn("Supabase Google OAuth fallback:", err.message);
      throw err;
    }
  };

  const loginWithEmail = async (email, password) => {
    if (!isSupabaseConfigured) {
      throw new Error('Email sign-in is unavailable until Supabase is configured. Use demo access to try the store.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.code === 'email_not_confirmed' || error.message.toLowerCase().includes('email not confirmed')) {
        throw new Error('Please verify your email using the confirmation link we sent before signing in.');
      }
      if (error.code === 'invalid_credentials' || error.message.toLowerCase().includes('invalid login credentials')) {
        throw new Error('Invalid email or password. Please check your credentials and try again.');
      }
      throw error;
    }
    if (!data.session || !data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('Please verify your email using the confirmation link we sent before signing in.');
    }
    syncSession(data.session);
    return data;
  };

  const signUpWithEmail = async (email, password, name = '', mobile = '') => {
    if (!isSupabaseConfigured) {
      throw new Error('Account creation is unavailable until Supabase is configured. Use demo access to try the store.');
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, mobile, role: 'customer' }
      }
    });
    if (error) throw error;
    if (data.user && data.user.identities?.length === 0) {
      throw new Error('An account with this email already exists. Try signing in or resetting your password.');
    }
    if (data.session && !data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('Email verification is not enabled for this project. Enable Confirm email in Supabase before creating accounts.');
    }
    if (data.session) {
      syncSession(data.session);
    }
    return data;
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
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setPasswordRecoveryRequired(false);
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
    syncSession(demo);
  };

  const loginDemoAdmin = () => {
    const demo = {
      access_token: 'demo-admin-token',
      user: {
        id: 'demo-admin-id',
        email: 'admin@ashvinpharma.com',
        role: 'admin',
        user_metadata: {
          name: 'Pharmacist Admin',
          role: 'admin',
          mobile: '+91 98450 12345'
        }
      }
    };
    localStorage.setItem('demo_session', JSON.stringify(demo));
    syncSession(demo);
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    localStorage.removeItem('demo_session');
    localStorage.removeItem('demo_auth_token');
    syncSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        isAdmin: role === 'admin',
        loading,
        passwordRecoveryRequired,
        loginWithGoogle,
        loginWithEmail,
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
