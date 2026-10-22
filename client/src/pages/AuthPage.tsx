import React, { useState } from 'react';

interface AuthPageProps { onAuthenticated?: () => void; }
const API_BASE = ((import.meta as any).env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

type AuthView = 'login' | 'forgot' | 'reset';

export const AuthPage: React.FC<AuthPageProps> = ({ onAuthenticated }) => {
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [view, setView] = useState<AuthView>(() => (new URLSearchParams(window.location.search).has('token') ? 'reset' : 'login'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showMessage = (text: string, error = false) => {
    setMessage(text);
    setIsError(error);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.data?.token && data.data?.session) {
        localStorage.setItem('auth_token', data.data.token);
        localStorage.setItem('auth_session', JSON.stringify(data.data.session));
        showMessage('Signed in successfully.');
        onAuthenticated?.();
      } else {
        showMessage(data.error?.message || 'Authentication failed.', true);
      }
    } catch {
      showMessage('Failed to connect to the authentication server.', true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage(data.data?.message || 'If your account is eligible, recovery instructions will be attempted.');
      } else {
        showMessage(data.error?.message || 'Password recovery is currently unavailable.', true);
      }
    } catch {
      showMessage('Could not reach the password recovery service.', true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showMessage('The passwords do not match.', true);
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128
      || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword)
      || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      showMessage('Use at least 12 characters with upper/lowercase letters, a number, and a symbol.', true);
      return;
    }
    if (!resetToken) {
      showMessage('This reset link is invalid. Request a new one.', true);
      return;
    }
    setIsSubmitting(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, password: newPassword }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_session');
        window.history.replaceState({}, document.title, window.location.pathname);
        setPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setView('login');
        showMessage(data.data?.message || 'Password changed. Please sign in again.');
      } else {
        showMessage(data.error?.message || 'The reset link could not be used.', true);
      }
    } catch {
      showMessage('Could not reach the password reset service.', true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const description = view === 'login'
    ? 'Sign in to access your CRM workspace'
    : view === 'forgot'
      ? 'Request a secure, single-use password reset link'
      : 'Choose a new password for your workspace';

  return (
    <div style={{ maxWidth: '440px', margin: '40px auto' }}>
      <div className="card" style={{ padding: '30px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div className="brandmark" style={{ margin: '0 auto 12px auto' }}>O</div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 4px 0' }}>OneClick Automics</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{description}</p>
        </div>

        {message && (
          <div
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
            style={{
              background: isError ? 'var(--red-subtle, #fef3f2)' : 'var(--green-subtle, #ecfdf3)',
              color: isError ? 'var(--red-text, #b42318)' : 'var(--green-text, #027a48)',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md, 8px)',
              marginBottom: '16px',
              fontSize: '12px',
            }}
          >
            {message}
          </div>
        )}

        {view === 'login' ? (
          <form onSubmit={handleLogin}>
            <div style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label htmlFor="login-email" style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Work Email</label>
                <input id="login-email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="form-control" style={{ width: '100%' }} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label htmlFor="login-password" style={{ fontSize: '12px', fontWeight: 600 }}>Password</label>
                  <a href="#forgot" onClick={(e) => { e.preventDefault(); setView('forgot'); showMessage(''); }} style={{ fontSize: '11px' }}>Forgot password?</a>
                </div>
                <input id="login-password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="form-control" style={{ width: '100%' }} />
              </div>
              <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}>
                {isSubmitting ? 'Signing in…' : 'Sign In to Workspace'}
              </button>
            </div>
          </form>
        ) : view === 'forgot' ? (
          <form onSubmit={handleForgot}>
            <div style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label htmlFor="recovery-email" style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Registered Work Email</label>
                <input id="recovery-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="form-control" style={{ width: '100%' }} />
              </div>
              <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                {isSubmitting ? 'Submitting…' : 'Send Password Reset Link'}
              </button>
              <div style={{ textAlign: 'center', marginTop: '6px' }}>
                <a href="#back" onClick={(e) => { e.preventDefault(); setView('login'); showMessage(''); }} style={{ fontSize: '12px' }}>← Back to Login</a>
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={handleReset}>
            <div style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label htmlFor="new-password" style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>New Password</label>
                <input id="new-password" type="password" required autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="form-control" style={{ width: '100%' }} />
              </div>
              <div>
                <label htmlFor="confirm-password" style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Confirm New Password</label>
                <input id="confirm-password" type="password" required autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="form-control" style={{ width: '100%' }} />
              </div>
              <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                {isSubmitting ? 'Resetting…' : 'Reset Password'}
              </button>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Reset links are single-use and expire after a short time.</p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
