import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppShell } from '@enterprise/shared-ui';

export const LoginView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const target = (location.state as any)?.from?.pathname || '/dashboard';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    localStorage.setItem('auth_token', 'active_pass_key');
    localStorage.setItem('refresh_token', 'active_refresh_key');
    navigate(target, { replace: true });
  };

  return (
    <AppShell showNav={false}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80dvh' }}>
        <form onSubmit={submit} style={{ backgroundColor: 'var(--color-bg-surface)', padding: 'var(--space-xl)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <h2 style={{ textAlign: 'center' }}>Enterprise Verification</h2>
          <button type="submit" disabled={loading} style={{ minHeight: 'var(--min-touch-target)', backgroundColor: 'var(--color-primary)', color: '#ffffff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer' }}>
            {loading ? 'Validating...' : 'Log In'}
          </button>
        </form>
      </div>
    </AppShell>
  );
};
