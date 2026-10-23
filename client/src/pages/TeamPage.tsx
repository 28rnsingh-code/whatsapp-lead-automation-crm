import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import {
  createTeamMemberApi,
  fetchTeamMembersApi,
  TeamMemberRecord,
  TeamMembersResponse,
  updateTeamMemberRoleApi,
  updateTeamMemberStatusApi,
} from '../services/api';

const ROLE_OPTIONS: TeamMemberRecord['role'][] = ['Admin', 'Sales Manager', 'Sales Executive', 'Read-only'];

function currentUserId(): string | null {
  try {
    const token = localStorage.getItem('auth_token') || '';
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return typeof payload.userId === 'string' ? payload.userId : null;
  } catch {
    return null;
  }
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export const TeamPage: React.FC = () => {
  const [team, setTeam] = useState<TeamMembersResponse>({ members: [], maxMembers: 2, planId: 'starter', remainingSeats: 2 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamMemberRecord['role']>('Sales Executive');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [createdMemberNotice, setCreatedMemberNotice] = useState('');

  const [pendingRoles, setPendingRoles] = useState<Record<string, TeamMemberRecord['role']>>({});
  const [roleSavingId, setRoleSavingId] = useState('');
  const [statusSavingId, setStatusSavingId] = useState('');

  const refreshTeam = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetchTeamMembersApi();
      setTeam(response);
      setPendingRoles(Object.fromEntries(response.members.map(member => [member.userId, member.role])));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Team details are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshTeam(); }, [refreshTeam]);

  const handleCreateMember = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setLoadError('');
    setNotice('');
    setTemporaryPassword('');
    setCreatedMemberNotice('');
    try {
      const result = await createTeamMemberApi({ email: inviteEmail.trim(), displayName: inviteName.trim(), role: inviteRole });
      if (result.createdNewAccount && result.temporaryPassword) {
        setTemporaryPassword(result.temporaryPassword);
        setCreatedMemberNotice('Account created. This temporary password is shown only now. Share it securely with the member; no email was sent.');
      } else {
        setCreatedMemberNotice('Existing account added to this workspace. Its password was not changed and no email was sent.');
      }
      setInviteEmail('');
      setInviteName('');
      setInviteRole('Sales Executive');
      await refreshTeam();
    } catch (error: any) {
      setLoadError(error instanceof Error ? error.message : 'Member could not be added.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleSave = async (member: TeamMemberRecord) => {
    const role = pendingRoles[member.userId] || member.role;
    if (role === member.role) return;
    setRoleSavingId(member.userId);
    setLoadError('');
    setNotice('');
    try {
      await updateTeamMemberRoleApi(member.userId, role);
      setNotice('Role updated for ' + member.email + '.');
      await refreshTeam();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Member role could not be updated.');
    } finally {
      setRoleSavingId('');
    }
  };

  const handleStatusToggle = async (member: TeamMemberRecord) => {
    const nextStatus = member.membershipStatus === 'active' ? 'suspended' : 'active';
    setStatusSavingId(member.userId);
    setLoadError('');
    setNotice('');
    try {
      await updateTeamMemberStatusApi(member.userId, nextStatus);
      setNotice(nextStatus === 'suspended' ? 'Member access suspended.' : 'Member access reactivated.');
      await refreshTeam();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Member status could not be updated.');
    } finally {
      setStatusSavingId('');
    }
  };

  const activeCount = team.members.filter(member => member.membershipStatus === 'active' && member.accountStatus === 'active').length;
  const signedInUserId = currentUserId();

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div className="page-header">
        <div>
          <h1>Team Members &amp; Permissions</h1>
          <div className="page-header-sub">
            Manage real workspace membership, roles and access. Changes are saved to the server.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => { setIsInviteOpen(true); setTemporaryPassword(''); setCreatedMemberNotice(''); setLoadError(''); }} disabled={team.remainingSeats <= 0 || loading}>
            + Add Member
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Current plan</div>
          <strong style={{ display: 'block', marginTop: '6px', textTransform: 'capitalize' }}>{team.planId}</strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Active members</div>
          <strong style={{ display: 'block', marginTop: '6px' }}>{activeCount} / {team.maxMembers}</strong>
        </div>
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Seats available</div>
          <strong style={{ display: 'block', marginTop: '6px' }}>{team.remainingSeats}</strong>
        </div>
      </div>

      {loadError && <div role="alert" className="card" style={{ padding: '12px', color: 'var(--red-text, #b42318)' }}>{loadError}</div>}
      {notice && <div role="status" className="card" style={{ padding: '12px' }}>{notice}</div>}
      {loading && <p role="status" style={{ color: 'var(--text-muted)' }}>Loading persisted workspace members…</p>}

      {!loading && !loadError && team.members.length === 0 && (
        <div className="card" style={{ padding: '28px', textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>No members found</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>This workspace has no active membership records to display.</p>
        </div>
      )}

      {!loading && team.members.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '12px' }}>Member</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>Access</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>Assigned leads</th>
                <th style={{ textAlign: 'left', padding: '12px' }}>Password setup</th>
                <th style={{ textAlign: 'right', padding: '12px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {team.members.map(member => {
                const active = member.membershipStatus === 'active' && member.accountStatus === 'active';
                const roleValue = pendingRoles[member.userId] || member.role;
                return (
                  <tr key={member.membershipId} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '12px' }}>
                      <strong style={{ display: 'block', fontSize: '13px' }}>{member.displayName}</strong>
                      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{member.email}</span>
                      <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '11px' }}>Added {formatDate(member.invitedAt)}</span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <select className="select-control" value={roleValue} onChange={event => setPendingRoles(previous => ({ ...previous, [member.userId]: event.target.value as TeamMemberRecord['role'] }))} disabled={member.userId === signedInUserId || Boolean(roleSavingId)} style={{ minWidth: '155px' }}>
                        {ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ color: active ? 'var(--green-text, #027a48)' : 'var(--amber-text, #b54708)', fontSize: '12px', fontWeight: 600 }}>{active ? 'Active' : member.membershipStatus}</span>
                      {member.accountStatus !== 'active' && <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>Account {member.accountStatus}</span>}
                    </td>
                    <td style={{ padding: '12px' }}>{Number(member.leadsAssigned || 0)}</td>
                    <td style={{ padding: '12px' }}>
                      {member.mustChangePassword ? <span style={{ color: 'var(--amber-text, #b54708)', fontSize: '12px' }}>Temporary password</span> : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>User-managed</span>}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-soft" onClick={() => void handleRoleSave(member)} disabled={roleValue === member.role || Boolean(roleSavingId)}>{roleSavingId === member.userId ? 'Saving…' : 'Save role'}</button>
                      <button className="btn" style={{ marginLeft: '6px' }} onClick={() => void handleStatusToggle(member)} disabled={statusSavingId === member.userId || member.role === 'Admin'}>{statusSavingId === member.userId ? 'Saving…' : active ? 'Suspend' : 'Reactivate'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={isInviteOpen} onClose={() => { if (!saving) setIsInviteOpen(false); }} title="Add workspace member">
        {createdMemberNotice ? (
          <div style={{ display: 'grid', gap: '14px' }}>
            <p role="status" style={{ margin: 0, fontSize: '13px' }}>{createdMemberNotice}</p>
            {temporaryPassword && (
              <div style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '12px', display: 'grid', gap: '8px' }}>
                <strong>One-time temporary password</strong>
                <code style={{ display: 'block', overflowWrap: 'anywhere', userSelect: 'all', padding: '10px', background: 'var(--surface-subtle, #f4f4f5)' }}>{temporaryPassword}</code>
                <button type="button" className="btn btn-soft" onClick={() => { void navigator.clipboard?.writeText(temporaryPassword).then(() => setNotice('Temporary password copied. Share it with the member securely.')).catch(() => setNotice('Select and copy the temporary password manually.')); }}>Copy temporary password</button>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>The member must change this password at first login. Close this window after securely sharing it; the password will not be shown again.</p>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => { setIsInviteOpen(false); setTemporaryPassword(''); setCreatedMemberNotice(''); }}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreateMember} style={{ display: 'grid', gap: '14px' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px' }}>Plan {team.planId} · {team.remainingSeats} seat(s) remaining. Temporary credentials are shown to Admin once; no invitation email is sent.</p>
            <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
              Member full name
              <input className="form-control" value={inviteName} onChange={event => setInviteName(event.target.value)} maxLength={120} placeholder="Full name" />
            </label>
            <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
              Work email *
              <input className="form-control" type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="member@company.com" autoComplete="email" />
            </label>
            <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 600 }}>
              Role
              <select className="select-control" value={inviteRole} onChange={event => setInviteRole(event.target.value as TeamMemberRecord['role'])}>
                {ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            {loadError && <p role="alert" style={{ color: 'var(--red-text, #b42318)', margin: 0, fontSize: '12px' }}>{loadError}</p>}
            <div className="modal-footer">
              <button className="btn" type="button" onClick={() => setIsInviteOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={saving || team.remainingSeats <= 0}>{saving ? 'Creating member…' : 'Create member'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
