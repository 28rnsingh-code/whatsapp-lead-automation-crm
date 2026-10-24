import React, { useState } from 'react';
import { changePasswordApi } from '../services/api';

interface PasswordChangePageProps {
  onSuccess: () => void;
}

export const PasswordChangePage: React.FC<PasswordChangePageProps> = ({ onSuccess }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setError('Use at least 12 characters including uppercase, lowercase, a number, and a symbol.');
      return;
    }
    setSaving(true);
    try {
      await changePasswordApi(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onSuccess();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Password could not be changed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: 'var(--page-bg, #f7f8fa)' }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: '100%', maxWidth: '460px', padding: '28px', display: 'grid', gap: '16px' }}>
        <div>
          <div className="brandmark" style={{ marginBottom: '14px' }}>O</div>
          <h1 style={{ margin: '0 0 8px', fontSize: '22px' }}>Set your own password</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
            Your administrator gave you a temporary password. Change it before entering the CRM.
          </p>
        </div>
        {error && <p role="alert" style={{ color: 'var(--red-text, #b42318)', fontSize: '13px', margin: 0 }}>{error}</p>}
        <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
          Temporary/current password
          <input type="password" autoComplete="current-password" required className="form-control" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
          New password
          <input type="password" autoComplete="new-password" minLength={12} required className="form-control" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
          Confirm new password
          <input type="password" autoComplete="new-password" minLength={12} required className="form-control" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
        </label>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Use at least 12 characters with uppercase, lowercase, number and symbol. Never share your new password.</p>
        <button className="btn btn-primary" type="submit" disabled={saving} style={{ justifyContent: 'center' }}>{saving ? 'Updating…' : 'Change password and continue'}</button>
      </form>
    </div>
  );
};
