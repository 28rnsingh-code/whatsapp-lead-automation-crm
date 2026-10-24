import React, { useState } from 'react';

interface AuthPageProps { onLoginSuccess: () => void; }

export const AuthPage: React.FC<AuthPageProps> = ({ onLoginSuccess }) => {
  const [view, setView] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
      const apiBase = /^https?:\/\//i.test(configuredApiBase) && !configuredApiBase.endsWith('/api')
        ? `${configuredApiBase}/api`
        : configuredApiBase;
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success && data.data?.token) {
        localStorage.setItem('auth_token', data.data.token);
        setIsError(false);
        setMessage('✓ Successfully signed in to One.Click Autonix CRM.');
        onLoginSuccess();
      } else {
        setIsError(true);
        setMessage(data.error?.message || 'Authentication failed.');
      }
    } catch {
      setIsError(true);
      setMessage('Failed to connect to authentication server.');
    }
    setTimeout(() => setMessage(''), 4000);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const recoveryEmail = String(formData.get('recoveryEmail') || '').trim();
    try {
      const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
      const apiBase = /^https?:\/\//i.test(configuredApiBase) && !configuredApiBase.endsWith('/api')
        ? `${configuredApiBase}/api`
        : configuredApiBase;
      const res = await fetch(`${apiBase}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail }),
      });
      const data = await res.json();
      setIsError(!res.ok || !data.success);
      setMessage(data.data?.message || data.error?.message || 'Password recovery is temporarily unavailable.');
    } catch {
      setIsError(true);
      setMessage('Failed to connect to password recovery service.');
    }
    setTimeout(() => setMessage(''), 5000);
  };

  return (
    <div style={{ maxWidth: '440px', margin: '40px auto' }}>
      <div className="card" style={{ padding: '30px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div className="brandmark" style={{ margin: '0 auto 12px auto' }}>O</div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 4px 0' }}>One.Click Autonix</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            {view === 'login' ? 'Sign in to access your CRM workspace' : 'Reset your workspace password'}
          </p>
        </div>

        {message && (
          <div
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
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Work Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>Password</label>
                  <a href="#forgot" onClick={(e) => { e.preventDefault(); setView('forgot'); }} style={{ fontSize: '11px' }}>
                    Forgot password?
                  </a>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}>
                Sign In to Workspace
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleForgot}>
            <div style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Registered Work Email</label>
                <input
                  type="email"
                  required
                  name="recoveryEmail"
                  placeholder="one.clickautonix@gmail.com"
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Send Password Reset Link
              </button>
              <div style={{ textAlign: 'center', marginTop: '6px' }}>
                <a href="#back" onClick={(e) => { e.preventDefault(); setView('login'); }} style={{ fontSize: '12px' }}>
                  ← Back to Login
                </a>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
