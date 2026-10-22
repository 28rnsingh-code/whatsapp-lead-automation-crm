import React, { useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../components/StatusPill';
import { downloadAuditCsvApi, fetchAuditEventsApi, AuditEventsResponse } from '../services/api';

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
export const AuditPage: React.FC = () => {
  const [result, setResult] = useState<AuditEventsResponse>({ events: [], totalCount: 0, page: 1, pageSize: 50, demoMode: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setResult(await fetchAuditEventsApi(1, 50)); }
    catch (err: any) { setError(err.message || 'Unable to load audit history.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const exportCsv = async () => {
    setExporting(true); setError('');
    try { saveBlob(await downloadAuditCsvApi(), 'oneclick-audit-trail.csv'); }
    catch (err: any) { setError(err.message || 'Unable to export audit events.'); }
    finally { setExporting(false); }
  };
  return (
    <div>
      <div className="page-header">
        <div><h1>Security & Compliance Audit Log</h1><div className="page-header-sub">Successful authenticated write operations; request bodies and credentials are not copied into audit metadata.</div></div>
        <div className="header-actions">
          <button className="btn btn-soft" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn" onClick={() => void exportCsv()} disabled={exporting || result.demoMode}>{exporting ? 'Exporting…' : 'Export audit CSV'}</button>
        </div>
      </div>
      {result.demoMode && <div className="card" style={{ marginBottom: 16 }}>Persistent audit storage is not available in demo mode; no sample entries are shown.</div>}
      {error && <div role="alert" className="card" style={{ borderColor: 'var(--red-text)', marginBottom: 16 }}>{error}</div>}
      <div className="card" style={{ padding: 0 }}><div className="table-container" style={{ border: 0 }}>
        <table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Target</th><th>Request context</th><th>Result</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}>Loading audit history…</td></tr> : result.events.length === 0 ? <tr><td colSpan={6}>No audit events recorded yet.</td></tr> :
              result.events.map((event) => <tr key={event.id}>
                <td><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{displayDate(event.occurredAt)}</span></td>
                <td><strong>{event.actor}</strong></td>
                <td><code style={{ fontSize: 11, background: 'var(--surface-secondary)', padding: '2px 6px', borderRadius: 4 }}>{event.action}</code></td>
                <td>{event.entityType} · {event.entityId}</td>
                <td><small style={{ color: 'var(--text-muted)' }}>{String((event.metadata && event.metadata.method) || '')} {String((event.metadata && event.metadata.path) || '')}</small></td>
                <td><StatusPill label="SUCCESS" variant="green" /></td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {!loading && result.events.length > 0 && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>Showing {result.events.length} of {result.totalCount} records, newest first.</div>}
      </div>
    </div>
  );
};
