import React, { useState } from 'react';
import { StatusPill } from '../components/StatusPill';
import { Modal } from '../components/Modal';

export const TeamPage: React.FC = () => {
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Sales Executive');

  const members = [
    { id: '1', name: 'Rohan Singh', email: 'rohan@bringmybite.in', role: 'Admin', status: 'Active', leadsAssigned: 14 },
    { id: '2', name: 'Riya Singh', email: 'riya@bringmybite.in', role: 'Sales Manager', status: 'Active', leadsAssigned: 42 },
    { id: '3', name: 'Vivek Arora', email: 'vivek@bringmybite.in', role: 'Sales Executive', status: 'Active', leadsAssigned: 38 },
    { id: '4', name: 'Ankit Jain', email: 'ankit@bringmybite.in', role: 'Sales Executive', status: 'Active', leadsAssigned: 28 },
    { id: '5', name: 'Sneha Patel', email: 'sneha@bringmybite.in', role: 'Read-only', status: 'Invited', leadsAssigned: 0 },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Team Members & Permissions</h1>
          <div className="page-header-sub">
            Manage workspace roles, lead assignment permissions, and member access boundaries.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setIsInviteModalOpen(true)}>
            + Invite Member
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-container" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Member Name</th>
                <th>Email Address</th>
                <th>Assigned Role</th>
                <th>Status</th>
                <th>Active Leads</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong></td>
                  <td>{m.email}</td>
                  <td>
                    <StatusPill
                      label={m.role}
                      variant={m.role === 'Admin' ? 'purple' : m.role === 'Sales Manager' ? 'blue' : 'amber'}
                      dot={false}
                    />
                  </td>
                  <td>
                    <span style={{ fontSize: '11px', color: m.status === 'Active' ? 'var(--green-text)' : 'var(--amber-text)' }}>
                      {m.status === 'Active' ? '✓ Active' : '✉ Invited'}
                    </span>
                  </td>
                  <td>{m.leadsAssigned} leads</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-soft" style={{ padding: '3px 8px', fontSize: '11px' }}>
                      Edit Role
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Member Modal */}
      <Modal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        title="Invite Team Member"
      >
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Work Email *</label>
            <input
              type="email"
              placeholder="colleague@bringmybite.in"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="form-control"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Assigned Role</label>
            <select
              className="select-control"
              style={{ width: '100%' }}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="Admin">Admin (Full workspace control)</option>
              <option value="Sales Manager">Sales Manager (Pipeline & team oversight)</option>
              <option value="Sales Executive">Sales Executive (Manage assigned leads)</option>
              <option value="Read-only">Read-only (Auditor / Viewer)</option>
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={() => setIsInviteModalOpen(false)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              alert(`Invitation sent to ${inviteEmail}`);
              setIsInviteModalOpen(false);
              setInviteEmail('');
            }}
          >
            Send Invitation
          </button>
        </div>
      </Modal>
    </div>
  );
};
