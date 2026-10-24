import React, { useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../components/StatusPill';
import { fetchWhatsAppConfigApi, fetchWhatsAppTemplatesApi, sendTestEmailApi, WhatsAppConfigResponse } from '../services/api';
import { NavigationPage } from '../types';

interface IntegrationsPageProps {
  onNavigate: (page: NavigationPage) => void;
  isDemo?: boolean;
}

export const IntegrationsPage: React.FC<IntegrationsPageProps> = ({ onNavigate, isDemo = false }) => {
  const [config, setConfig] = useState<WhatsAppConfigResponse | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingTemplates, setRefreshingTemplates] = useState(false);
  const [error, setError] = useState('');
  const [templatesError, setTemplatesError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('OneClick Automics automation test');
  const [emailBody, setEmailBody] = useState('This is a test of the CRM email automation workflow.');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState('');
  const [emailError, setEmailError] = useState('');

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

  useEffect(() => {
    if (isDemo) { setLoading(false); setConfig(null); return; }
    void loadConfig();
  }, [loadConfig, isDemo]);

  const handleSendTestEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setSendingEmail(true); setEmailNotice(''); setEmailError('');
    try {
      const result = await sendTestEmailApi({ to: emailTo.trim(), subject: emailSubject.trim(), textContent: emailBody.trim(), idempotencyKey: crypto.randomUUID() });
      setEmailNotice(result.status === 'simulated'
        ? 'Demo complete: this email was simulated only. No recipient was contacted. This uses one of five demo actions.'
        : 'The provider accepted this email for delivery; inbox delivery is not confirmed. Check provider logs.');
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Email test failed. No successful send has been assumed.');
    } finally { setSendingEmail(false); }
  };

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

      <section className="card" style={{ marginBottom: '20px' }}>
        <div className="card-header"><div><h2>{isDemo ? 'Email Automation — Demo Test' : 'Email Delivery Test'}</h2><small style={{ color: 'var(--text-muted)' }}>Single-recipient transactional test</small></div><StatusPill label={isDemo ? 'Simulation only' : 'Provider required'} variant={isDemo ? 'amber' : 'blue'} /></div>
        <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-muted)' }}>{isDemo ? 'Demo never calls an email provider or contacts the recipient. Each test consumes one of five shared demo actions.' : 'Live email requires a server-side Brevo API key and verified sender. No API key is exposed in this page; an unconfigured sender returns an error.'}</p>
        <form onSubmit={(event) => void handleSendTestEmail(event)} style={{ display: 'grid', gap: '12px', maxWidth: '720px' }}>
          <div><label htmlFor="test-email-to" style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Recipient email</label><input id="test-email-to" type="email" required maxLength={254} value={emailTo} onChange={(event) => setEmailTo(event.target.value)} className="form-control" placeholder="you@example.com" style={{ width: '100%' }} /></div>
          <div><label htmlFor="test-email-subject" style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Subject</label><input id="test-email-subject" type="text" required maxLength={160} value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} className="form-control" style={{ width: '100%' }} /></div>
          <div><label htmlFor="test-email-body" style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Email text</label><textarea id="test-email-body" required maxLength={5000} rows={4} value={emailBody} onChange={(event) => setEmailBody(event.target.value)} className="form-control" style={{ width: '100%', resize: 'vertical' }} /></div>
          {emailError && <p role="alert" style={{ color: 'var(--red-text, #b42318)', fontSize: '12px', margin: 0 }}>{emailError}</p>}
          {emailNotice && <p role="status" style={{ color: 'var(--text-primary)', background: 'var(--surface-secondary)', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', margin: 0 }}>{emailNotice}</p>}
          <div><button type="submit" className="btn btn-primary" disabled={sendingEmail}>{sendingEmail ? 'Processing…' : isDemo ? 'Run simulated email test' : 'Send test email'}</button></div>
        </form>
      </section>
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
