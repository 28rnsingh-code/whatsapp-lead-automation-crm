import React, { useState } from 'react';
import { acceptTeamInvitationApi } from '../services/api';
interface InvitationAcceptancePageProps { token: string; onBackToLogin: () => void; }
export const InvitationAcceptancePage: React.FC<InvitationAcceptancePageProps> = ({ token, onBackToLogin }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [result, setResult] = useState<{ email: string; workspaceName: string; passwordAlreadySet: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const accept = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (password && password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await acceptTeamInvitationApi({ token: token, password: password || undefined });
      setResult({ email: response.email, workspaceName: response.workspaceName, passwordAlreadySet: response.passwordAlreadySet });
    } catch (err: any) { setError(err.message || 'Unable to accept this invitation.'); }
    finally { setBusy(false); }
  };
  return <div className="app-container" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
    <div className="card" style={{ width: 'min(100%, 460px)', padding: 28 }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}><div className="brandmark" style={{ margin: '0 auto 12px auto' }}>O</div>
        <h1 style={{ fontSize: 21, fontWeight: 800, margin: '0 0 6px' }}>Accept workspace invitation</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>This one-time link expires after seven days.</p></div>
      {result ? <>
        <div role="status" style={{ padding: 14, borderRadius: 8, background: 'var(--green-subtle)', color: 'var(--green-text)', marginBottom: 18 }}>
          <strong>Invitation accepted.</strong>
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>{result.email} now has access to {result.workspaceName}. Sign in to continue. {result.passwordAlreadySet ? 'Use your existing password.' : 'Use the password you set below.'}</p>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onBackToLogin}>Continue to sign in</button>
      </> : <form onSubmit={(event) => void accept(event)}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>New password (new accounts only)</label>
        <input type="password" className="form-control" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" minLength={12} style={{ width: '100%', marginBottom: 10 }} />
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Confirm new password</label>
        <input type="password" className="form-control" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} style={{ width: '100%', marginBottom: 10 }} />
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Existing users can leave both fields blank and sign in with their current password after acceptance.</p>
        {error && <div role="alert" style={{ color: 'var(--red-text)', fontSize: 13, margin: '12px 0' }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>{busy ? 'Accepting…' : 'Accept invitation'}</button>
        <button type="button" className="btn" onClick={onBackToLogin} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>Back to sign in</button>
      </form>}
      <p style={{ marginTop: 18, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>Never share this invitation URL publicly. The token is consumed after acceptance.</p>
    </div>
  </div>;
};
