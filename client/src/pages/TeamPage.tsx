import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { createTeamMemberApi, fetchTeamMembersApi, TeamMemberRecord, TeamMembersResponse, updateTeamMemberRoleApi, updateTeamMemberStatusApi } from '../services/api';

const ROLES: TeamMemberRecord['role'][] = ['Admin', 'Sales Manager', 'Sales Executive', 'Read-only'];

export const TeamPage: React.FC = () => {
  const [team, setTeam] = useState<TeamMembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamMemberRecord['role']>('Sales Executive');
  const [credential, setCredential] = useState<any>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setTeam(await fetchTeamMembersApi()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load members.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const addMember = async () => {
    setSaving(true); setError(''); setNotice(''); setCredential(null);
    try {
      const created = await createTeamMemberApi({ email: email.trim(), displayName: name.trim(), role });
      setCredential(created);
      setNotice(created.createdNewAccount
        ? 'Member created. Copy the temporary password below and share securely; no email was sent.'
        : 'Existing account added. No new password was generated and no email was sent.');
      setInviteOpen(false); setName(''); setEmail('');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Member could not be added.'); }
    finally { setSaving(false); }
  };

  const alterRole = async (member: TeamMemberRecord, nextRole: TeamMemberRecord['role']) => {
    if (member.role === nextRole) return;
    setSaving(true); setError(''); setNotice('');
    try { await updateTeamMemberRoleApi(member.userId, nextRole); setNotice('Member role updated.'); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Role update failed.'); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (member: TeamMemberRecord) => {
    const status = member.membershipStatus === 'active' ? 'suspended' : 'active';
    setSaving(true); setError(''); setNotice('');
    try { await updateTeamMemberStatusApi(member.userId, status); setNotice(`Member access ${status}.`); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Member status update failed.'); }
    finally { setSaving(false); }
  };

  const activeCount = team?.members.filter(m => m.membershipStatus === 'active' && m.accountStatus === 'active').length || 0;
  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(String(credential.temporaryPassword));
      setNotice('Temporary password copied. Share it only through a secure channel.');
    } catch { setError('Clipboard was blocked. Select the temporary password and copy it manually.'); }
  };

  return <div>
    <div className="page-header"><div><h1>Team Members & Permissions</h1><div className="page-header-sub">Manage real workspace members, access roles and plan-based seat limits.</div></div>
      <div className="header-actions"><button className="btn" onClick={() => void refresh()} disabled={loading || saving}>Refresh</button><button className="btn btn-primary" onClick={() => { setError(''); setInviteOpen(true); }} disabled={loading || saving || Boolean(team && team.remainingSeats <= 0)}>+ Add Member</button></div>
    </div>
    {team && <div className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div><strong>{team.planId.toUpperCase()} plan</strong><p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>Seat limits are enforced by the server.</p></div>
      <div><strong>{activeCount} / {team.maxMembers} seats used</strong><p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>{team.remainingSeats} remaining</p></div>
    </div>}
    {error && <div role="alert" className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--red-text, #b42318)' }}>{error}</div>}
    {notice && <div role="status" className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--green-text, #027a48)' }}>{notice}</div>}
    {credential?.temporaryPassword && <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Temporary password — shown once</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>For {credential.email}. Share through a secure channel. First login requires the member to change it. No email was sent.</p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><code style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, userSelect: 'all', overflowWrap: 'anywhere' }}>{credential.temporaryPassword}</code><button className="btn btn-primary" onClick={() => void copyPassword()}>Copy password</button><button className="btn" onClick={() => setCredential(null)}>Dismiss</button></div>
    </div>}
    <div className="card" style={{ padding: 0 }}>
      {loading ? <p role="status" style={{ padding: 18, color: 'var(--text-muted)' }}>Loading saved team members…</p> : <div className="table-container" style={{ border: 0 }}><table>
        <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Active Leads</th><th>Actions</th></tr></thead>
        <tbody>{(team?.members || []).map(member => <tr key={member.membershipId}>
          <td><strong>{member.displayName}</strong><small style={{ display: 'block', color: 'var(--text-muted)' }}>{member.email}</small></td>
          <td><select aria-label={`Role for ${member.email}`} className="select-control" value={member.role} disabled={saving || (member.role === 'Admin' && activeCount <= 1)} onChange={e => void alterRole(member, e.target.value as TeamMemberRecord['role'])}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></td>
          <td><span style={{ color: member.membershipStatus === 'active' ? 'var(--green-text)' : 'var(--amber-text)', fontSize: 12 }}>{member.membershipStatus === 'active' ? '● Active' : 'Suspended'}</span>{member.mustChangePassword && <small style={{ display: 'block', color: 'var(--amber-text)' }}>Must change password</small>}</td>
          <td>{Number(member.leadsAssigned || 0)}</td>
          <td><button className="btn btn-soft" disabled={saving || (member.role === 'Admin' && activeCount <= 1)} onClick={() => void toggleStatus(member)} style={{ padding: '5px 8px', fontSize: 11 }}>{member.membershipStatus === 'active' ? 'Suspend' : 'Activate'}</button></td>
        </tr>)}{team?.members.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20 }}>No workspace members found.</td></tr>}</tbody>
      </table></div>}
    </div>
    <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Add workspace member">
      <div style={{ display: 'grid', gap: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Full name<input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="Member name" style={{ width: '100%', marginTop: 5 }} /></label>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Work email *<input type="email" required className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="colleague@company.com" style={{ width: '100%', marginTop: 5 }} /></label>
        <label style={{ fontSize: 12, fontWeight: 600 }}>Role<select className="select-control" value={role} onChange={e => setRole(e.target.value as TeamMemberRecord['role'])} style={{ width: '100%', marginTop: 5 }}>{ROLES.filter(r => r !== 'Admin').map(r => <option key={r} value={r}>{r}</option>)}</select></label>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>A new account gets a temporary password that is shown once. Automated email invitation is not configured.</p>
      </div>
      <div className="modal-footer"><button className="btn" onClick={() => setInviteOpen(false)} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={() => void addMember()} disabled={saving || !email.trim()}>{saving ? 'Creating…' : 'Create member'}</button></div>
    </Modal>
  </div>;
};
