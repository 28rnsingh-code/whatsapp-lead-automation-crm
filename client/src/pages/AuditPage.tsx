import React from 'react';
import { StatusPill } from '../components/StatusPill';

export const AuditPage: React.FC = () => {
  const events = [
    { id: 'aud-1', actor: 'Rohan Singh', action: 'LEAD_CREATE', entity: 'Lead #Amit Sharma', time: '10 min ago', ip: '103.21.12.44', status: 'SUCCESS' },
    { id: 'aud-2', actor: 'Riya Singh', action: 'STAGE_ADVANCE', entity: 'Lead #Karan Malhotra (Qualified → Proposal)', time: '35 min ago', ip: '103.21.12.45', status: 'SUCCESS' },
    { id: 'aud-3', actor: 'System Webhook', action: 'INBOUND_WHATSAPP_CAPTURE', entity: 'Lead #Neha Gupta (+91 98765 43219)', time: '1 hour ago', ip: '157.240.22.35 (Meta)', status: 'SUCCESS' },
    { id: 'aud-4', actor: 'Vivek Arora', action: 'DEAL_WON', entity: 'Lead #Rahul Verma (₹2,10,000)', time: '2 hours ago', ip: '103.21.12.48', status: 'SUCCESS' },
    { id: 'aud-5', actor: 'Rohan Singh', action: 'MEMBER_INVITE', entity: 'User #sneha@bringmybite.in (Read-only)', time: 'Yesterday', ip: '103.21.12.44', status: 'SUCCESS' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Security & Compliance Audit Log</h1>
          <div className="page-header-sub">
            Immutable server-recorded activity stream for security governance, mutation audits, and compliance.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => alert('Download tamper-evident Audit CSV')}>
            Export Audit Trail
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-container" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target Resource</th>
                <th>Client Source</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{e.time}</span></td>
                  <td><strong>{e.actor}</strong></td>
                  <td><code style={{ fontSize: '11px', background: 'var(--surface-secondary)', padding: '2px 6px', borderRadius: '4px' }}>{e.action}</code></td>
                  <td>{e.entity}</td>
                  <td><small style={{ color: 'var(--text-muted)' }}>{e.ip}</small></td>
                  <td><StatusPill label={e.status} variant="green" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
