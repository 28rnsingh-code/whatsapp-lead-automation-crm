import React, { useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../components/StatusPill';
import { Modal } from '../components/Modal';
import { createTeamInvitationApi, fetchTeamMembersApi, TeamMember, TeamMembersResponse, updateTeamMemberApi } from '../services/api';

const ROLES: TeamMember['role'][] = ['Admin', 'Sales Manager', 'Sales Executive', 'Read-only'];
export const TeamPage: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<TeamMember['role']>('Sales Executive');
  const [team, setTeam] = useState<TeamMembersResponse>({ members: [], demoMode: false });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setTeam(await fetchTeamMembersApi()); }
    catch (err: any) { setError(err.message || 'Unable to load team members.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const invite = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage(''); setInviteUrl('');
    try {
      const result = await createTeamInvitationApi({ email: email, displayName: displayName, role: role });
      setInviteUrl(result.inviteUrl); setMessage(result.message); setEmail(''); setDisplayName(''); setModalOpen(false);
      await refresh();
    } catch (err: any) { setError(err.message || 'Unable to create invitation.'); }
  };
  const updateMember = async (member: TeamMember, changes: { role?: TeamMember['role']; status?: 'active' | 'suspended' }) => {
    setBusyId(member.membershipId); setError(''); setMessage('');
    try { await updateTeamMemberApi(member.membershipId, changes); setMessage('Member updated.'); await refresh(); }
    catch (err: any) { setError(err.message || 'Unable to update member.'); }
    finally { setBusyId(''); }
  };
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setMessage('Invitation link copied. Share it privately.'); }
    catch { setMessage('Clipboard is unavailable. Select and copy the URL manually.'); }
  };
  const statusText = (member: TeamMember) => member.status === 'active' ? 'Active' : member.status === 'suspended' ? 'Suspended' : 'Invited';
  return (
    <div>
      <div className="page-header">
        <div><h1>Team Members & Permissions</h1><div className="page-header-sub">Workspace-scoped roles and access; invitation links are single-use and expire after seven days.</div></div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setModalOpen(true)} disabled={team.demoMode}>+ Invite Member</button>
          <button className="btn btn-soft" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>
      {team.demoMode && <div className="card" style={{ marginBottom: 16 }}>Demo mode: these are sample members; real invitations require a persistent database.</div>}
      {message && <div className="card" role="status" style={{ marginBottom: 16 }}>{message}</div>}
      {error && <div className="card" role="alert" style={{ borderColor: 'var(--red-text)', marginBottom: 16 }}>{error}</div>}
      {inviteUrl && <div className="card" style={{ marginBottom: 16 }}>
        <strong>Invitation link created</strong><p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No email was sent. Share this one-time link privately.</p>
        <input className="form-control" readOnly value={inviteUrl} style={{ width: '100%', marginBottom: 10 }} />
        <button className="btn btn-soft" onClick={() => void copyInvite()}>Copy invitation link</button>
      </div>}
      <div className="card" style={{ padding: 0 }}><div className="table-container" style={{ border: 0 }}>
        <table><thead><tr><th>Member</th><th>Email</th><th>Role</th><th>Status</th><th>Active leads</th><th>Access</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}>Loading members…</td></tr> : team.members.length === 0 ? <tr><td colSpan={6}>No workspace members found.</td></tr> :
              team.members.map((member) => <tr key={member.membershipId}>
                <td><strong>{member.name}</strong></td><td>{member.email}</td>
                <td><select className="select-control" value={member.role} disabled={team.demoMode || busyId === member.membershipId} aria-label={'Change role for ' + member.email} onChange={(event) => void updateMember(member, { role: event.target.value as TeamMember['role'] })}>
                  {ROLES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select></td>
                <td><StatusPill label={statusText(member)} variant={member.status === 'active' ? 'green' : member.status === 'suspended' ? 'red' : 'amber'} dot={false} /></td>
                <td>{member.leadsAssigned}</td><td>
                  {member.status === 'invited' ? 'Awaiting acceptance' :
                    <button className="btn btn-soft" disabled={team.demoMode || busyId === member.membershipId} onClick={() => void updateMember(member, { status: member.status === 'active' ? 'suspended' : 'active' })}>{member.status === 'active' ? 'Suspend access' : 'Reactivate'}</button>}
                </td>
              </tr>)}
          </tbody>
        </table>
      </div></div>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Invite Team Member">
        <form onSubmit={(event) => void invite(event)}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div><label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Work email *</label><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="form-control" placeholder="colleague@company.com" style={{ width: '100%' }} /></div>
            <div><label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Display name</label><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="form-control" placeholder="Colleague name" style={{ width: '100%' }} /></div>
            <div><label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Assigned role</label><select className="select-control" value={role} onChange={(event) => setRole(event.target.value as TeamMember['role'])} style={{ width: '100%' }}>{ROLES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>This creates a seven-day one-time link. Email sending is not configured; copy the link and send it through your approved channel.</p>
          <div className="modal-footer"><button type="button" className="btn" onClick={() => setModalOpen(false)}>Cancel</button><button type="submit" className="btn btn-primary">Create invitation</button></div>
        </form>
      </Modal>
    </div>
  );
};
