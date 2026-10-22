import React, { useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../components/StatusPill';
import { NavigationPage } from '../types';
import {
  fetchIntegrationStatusApi,
  rotateWebsiteWebhookApi,
  IntegrationStatusResponse,
} from '../services/api';

interface IntegrationsPageProps {
  onNavigate: (page: NavigationPage) => void;
}

export const IntegrationsPage: React.FC<IntegrationsPageProps> = ({ onNavigate }) => {
  const [status, setStatus] = useState<IntegrationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [issuedSecret, setIssuedSecret] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await fetchIntegrationStatusApi());
    } catch (err: any) {
      setError(err.message || 'Unable to load live integration status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const rotateSecret = async () => {
    setRotating(true);
    setError('');
    setMessage('');
    try {
      const result = await rotateWebsiteWebhookApi();
      setIssuedSecret(result.secret);
      setMessage('Webhook secret created. Copy it now; it is shown only once.');
      await refreshStatus();
    } catch (err: any) {
      setError(err.message || 'Unable to rotate the webhook secret.');
    } finally {
      setRotating(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} copied to clipboard.`);
    } catch {
      setMessage(`Clipboard access was unavailable. Select and copy the ${label.toLowerCase()} manually.`);
    }
  };

  const pill = (configured: boolean, configuredLabel = 'Configured') => (
    <StatusPill label={configured ? configuredLabel : 'Not configured'} variant={configured ? 'green' : 'amber'} />
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>External Integrations</h1>
          <div className="page-header-sub">
            Live workspace status for web lead capture, WhatsApp Business and AI providers. Secrets are never shown after issuance.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-soft" onClick={() => void refreshStatus()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh status'}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="card" style={{ borderColor: 'var(--red-text)', marginBottom: 16 }}>{error}</div>}
      {message && <div role="status" className="card" style={{ marginBottom: 16 }}>{message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 20 }}>
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Website Lead Webhook</h2>
              <small style={{ color: 'var(--text-muted)' }}>Signed HTTPS requests create website-sourced leads in this workspace.</small>
            </div>
            {pill(Boolean(status?.webhook.configured))}
          </div>
          {loading && !status ? <p>Loading workspace status…</p> : (
            <>
              <div style={{ display: 'grid', gap: 12, margin: '14px 0' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Webhook URL</label>
                  <input className="form-control" readOnly value={status?.webhook.endpoint || ''} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Workspace slug</label>
                  <input className="form-control" readOnly value={status?.tenantSlug || ''} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Current secret</label>
                  <input className="form-control" readOnly value={issuedSecret || status?.webhook.secretMasked || (status?.webhook.configured ? '••••••••' : 'Not created')} style={{ width: '100%' }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => void rotateSecret()} disabled={rotating || loading}>
                  {rotating ? 'Creating…' : status?.webhook.configured ? 'Rotate secret' : 'Create webhook secret'}
                </button>
                {status?.webhook.endpoint && <button className="btn btn-soft" onClick={() => void copyText(status.webhook.endpoint, 'Webhook URL')}>Copy URL</button>}
                {issuedSecret && <button className="btn btn-soft" onClick={() => void copyText(issuedSecret, 'Webhook secret')}>Copy secret</button>}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                Send JSON with <code>tenantSlug</code>, <code>name</code>, and <code>phoneRaw</code>, plus the <code>x-oneclick-webhook-secret</code> header. A rotated secret immediately invalidates the previous secret. Lead consent defaults to Unknown unless your form explicitly reports consent.
              </p>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2>WhatsApp Business API</h2>
              <small style={{ color: 'var(--text-muted)' }}>Meta Cloud API or Gupshup, configured in Settings.</small>
            </div>
            {pill(Boolean(status?.whatsapp.configured), status?.whatsapp.provider || 'Configured')}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {status?.whatsapp.configured
              ? `Provider: ${status.whatsapp.provider}. Its saved status is ${status.whatsapp.status}.`
              : 'No connected provider is saved for this workspace.'}
          </p>
          <button className="btn btn-soft" onClick={() => onNavigate('settings')}>Open integration settings</button>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2>AI Reply Provider</h2>
              <small style={{ color: 'var(--text-muted)' }}>OpenAI or Gemini; drafts and send modes are configured in Settings.</small>
            </div>
            {pill(Boolean(status?.ai.configured), status?.ai.provider || 'Configured')}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {status?.ai.configured
              ? `Provider: ${status.ai.provider}; mode: ${status.ai.mode}; saved status: ${status.ai.status}.`
              : 'No enabled AI provider is saved for this workspace.'}
          </p>
          <button className="btn btn-soft" onClick={() => onNavigate('settings')}>Open AI settings</button>
        </div>
      </div>
    </div>
  );
};
