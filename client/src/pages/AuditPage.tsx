import React, { useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../components/StatusPill';
import { AuditEventRecord, fetchAuditEventsApi } from '../services/api';

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export const AuditPage: React.FC = () => {
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const actualEvents = await fetchAuditEventsApi(250);
      setEvents(actualEvents);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load audit events.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const exportAuditTrail = () => {
    if (events.length === 0) {
      setNotice('There are no recorded audit events to export.');
      return;
    }
    const headers = ['Timestamp', 'Actor', 'Action', 'Resource Type', 'Resource ID', 'Source', 'Status', 'Request ID'];
    const rows = events.map((event) => [
      event.occurredAt,
      event.actor,
      event.action,
      event.entityType,
      event.entityId,
      event.source,
      event.status,
      event.requestId || '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `carepilot-crm-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${events.length} recorded events.`);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Security & Compliance Audit Log</h1>
          <div className="page-header-sub">
            Server-recorded tenant activity. Only successful authenticated write operations are included in this release.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-soft" onClick={() => void loadEvents()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn" onClick={exportAuditTrail} disabled={loading || events.length === 0}>
            Export Audit CSV
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', marginBottom: '16px' }}>
          <strong>Unable to load audit log:</strong> {error}
        </div>
      )}
      {notice && (
        <div role="status" style={{ padding: '10px 14px', background: 'var(--surface-secondary)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
          {notice}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-container" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target Resource</th>
                <th>Source</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading audit events…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Audit data is unavailable. Refresh after the service is restored.</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No recorded audit events are available for this workspace yet.</td></tr>
              ) : events.map((event) => (
                <tr key={event.id}>
                  <td><span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{new Date(event.occurredAt).toLocaleString()}</span></td>
                  <td><strong>{event.actor}</strong></td>
                  <td><code style={{ fontSize: '11px', background: 'var(--surface-secondary)', padding: '2px 6px', borderRadius: '4px' }}>{event.action}</code></td>
                  <td>{event.entity}</td>
                  <td><small style={{ color: 'var(--text-muted)' }}>{event.source}</small></td>
                  <td><StatusPill label={event.status} variant={event.status === 'SUCCESS' ? 'green' : 'red'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
