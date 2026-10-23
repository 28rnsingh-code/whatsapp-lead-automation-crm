import React, { useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../components/StatusPill';
import { fetchWhatsAppConfigApi, fetchWhatsAppTemplatesApi, WhatsAppConfigResponse } from '../services/api';
import { NavigationPage } from '../types';

interface IntegrationsPageProps {
  onNavigate: (page: NavigationPage) => void;
}

export const IntegrationsPage: React.FC<IntegrationsPageProps> = ({ onNavigate }) => {
  const [config, setConfig] = useState<WhatsAppConfigResponse | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingTemplates, setRefreshingTemplates] = useState(false);
  const [error, setError] = useState('');
  const [templatesError, setTemplatesError] = useState('');
  const [notice, setNotice] = useState('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await fetchWhatsAppConfigApi();
      setConfig(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The configured WhatsApp connection could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const loadTemplates = async () => {
    setRefreshingTemplates(true);
    setTemplatesError('');
    setNotice('');
    try {
      const rows = await fetchWhatsAppTemplatesApi();
      setTemplates(rows);
      setNotice(`Loaded ${rows.length} template records from the configured source.`);
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : 'Template data could not be loaded.');
    } finally {
      setRefreshingTemplates(false);
    }
  };

  const copyApiPath = async () => {
    try {
      await navigator.clipboard.writeText('/api/leads');
      setNotice('Copied /api/leads. Call it from a trusted server with an authenticated tenant token; never embed a secret in browser code.');
    } catch {
      setError('Clipboard access was denied by the browser. Copy /api/leads from the text field manually.');
    }
  };

  const wa = config?.config;
  const connectionLabel = loading ? 'Checking…' : error ? 'Unavailable' :
    wa?.status === 'connected' ? 'Credentials verified' :
    wa?.status === 'error' ? 'Configuration error' : 'Not configured';
  const connectionVariant = wa?.status === 'connected' && !error ? 'green' :
    (error || wa?.status === 'error') ? 'red' : 'amber';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>External Integrations</h1>
          <div className="page-header-sub">
            Live integration status comes from the CRM backend. Unconfigured services are not reported as connected.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-soft" onClick={() => void loadConfig()} disabled={loading}>
            {loading ? 'Checking…' : 'Refresh status'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ background: '#fef2f2', color: '#b42318', padding: '12px 16px', borderRadius: '8px', marginBottom: '18px' }}>
          <strong>Integration status unavailable:</strong> {error}
        </div>
      )}
      {notice && (
        <div role="status" style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)', padding: '12px 16px', borderRadius: '8px', marginBottom: '18px', fontSize: '13px' }}>
          {notice}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
        <section className="card">
          <div className="card-header">
            <div>
              <h2>Website Lead Capture</h2>
              <small style={{ color: 'var(--text-muted)' }}>Authenticated CRM API for trusted server-side integrations</small>
            </div>
            <StatusPill label="Webhook not configured" variant="amber" />
          </div>
          <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
            A dedicated signed public website webhook is not implemented in this release. No fake URL or secret is shown. Existing lead creation is provided by the authenticated API route below.
          </p>
          <div style={{ display: 'grid', gap: '6px' }}>
            <label htmlFor="lead-api-path" style={{ fontSize: '12px', fontWeight: 600 }}>Lead API route</label>
            <input id="lead-api-path" type="text" readOnly value="/api/leads" className="form-control" style={{ width: '100%', background: 'var(--surface-secondary)' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
            <button className="btn btn-soft" onClick={() => void copyApiPath()}>Copy API path</button>
          </div>
          <small style={{ display: 'block', marginTop: '10px', color: 'var(--text-muted)' }}>
            Public forms require a dedicated signed endpoint and rate limiting before unauthenticated browser submissions are supported.
          </small>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2>WhatsApp Business API</h2>
              <small style={{ color: 'var(--text-muted)' }}>
                {wa?.provider === 'cloud_api' ? 'Meta WhatsApp Cloud API' : wa?.provider || 'No provider selected'}
              </small>
            </div>
            <StatusPill label={connectionLabel} variant={connectionVariant as any} />
          </div>

          {loading ? <p role="status" style={{ color: 'var(--text-muted)' }}>Loading saved workspace configuration…</p> : (
            <div style={{ display: 'grid', gap: '12px', margin: '14px 0' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>WhatsApp Business Account ID</label>
                <input readOnly value={wa?.businessAccountId || 'Not configured'} className="form-control" style={{ width: '100%', background: 'var(--surface-secondary)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Phone Number ID</label>
                <input readOnly value={wa?.phoneNumberId || 'Not configured'} className="form-control" style={{ width: '100%', background: 'var(--surface-secondary)' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Webhook callback URL</label>
                <input readOnly value={config?.webhookUrl || 'Unavailable'} className="form-control" style={{ width: '100%', background: 'var(--surface-secondary)' }} />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {wa?.lastTestedAt ? `Last credential verification: ${new Date(wa.lastTestedAt).toLocaleString()}` : 'No successful credential verification recorded.'}
                {wa?.errorMessage ? <p role="alert" style={{ color: 'var(--red-text, #b42318)' }}>{wa.errorMessage}</p> : null}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
            <button className="btn btn-primary" onClick={() => onNavigate('settings')}>Open WhatsApp Settings</button>
            <button className="btn btn-soft" onClick={() => void loadTemplates()} disabled={refreshingTemplates || loading || wa?.status !== 'connected'}>
              {refreshingTemplates ? 'Loading templates…' : 'Load available templates'}
            </button>
          </div>

          {templatesError && <p role="alert" style={{ color: 'var(--red-text, #b42318)', fontSize: '12px', marginTop: '12px' }}>{templatesError}</p>}
          {templates.length > 0 && (
            <div style={{ marginTop: '14px', borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
              <strong style={{ fontSize: '12px' }}>Available template records ({templates.length})</strong>
              <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                {templates.slice(0, 5).map((template, index) => (
                  <div key={template.id || template.name || index} style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                    <span>{template.name || 'Unnamed template'}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{template.status || 'Status unknown'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
