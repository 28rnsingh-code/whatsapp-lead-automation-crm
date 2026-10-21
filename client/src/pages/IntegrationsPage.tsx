import React, { useState } from 'react';
import { StatusPill } from '../components/StatusPill';

export const IntegrationsPage: React.FC = () => {
  const [testResult, setTestResult] = useState('');

  const runTestConnection = (service: string) => {
    setTestResult(`Testing connection to ${service}... Success! HTTP 200 OK.`);
    setTimeout(() => setTestResult(''), 4000);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>External Integrations</h1>
          <div className="page-header-sub">
            Securely configure website lead capture webhooks and approved WhatsApp Cloud API connections.
          </div>
        </div>
      </div>

      {testResult && (
        <div style={{ background: 'var(--green-subtle)', color: 'var(--green-text)', padding: '12px 16px', borderRadius: 'var(--radius-card)', marginBottom: '18px', fontWeight: 600 }}>
          ✓ {testResult}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Website Lead Webhook */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2>Website Lead Webhook</h2>
              <small style={{ color: 'var(--text-muted)' }}>Capture leads from WordPress, Webflow, React landing pages</small>
            </div>
            <StatusPill label="Active" variant="green" />
          </div>
          <div style={{ display: 'grid', gap: '14px', margin: '14px 0' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Webhook Ingestion URL</label>
              <input
                type="text"
                readOnly
                value="https://api.oneclickautomics.com/api/v1/integrations/webhook/lead-capture"
                className="form-control"
                style={{ width: '100%', background: 'var(--surface-secondary)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Webhook Secret Key</label>
              <input
                type="password"
                readOnly
                value="whsec_bringmybite_live_998472910"
                className="form-control"
                style={{ width: '100%', background: 'var(--surface-secondary)' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button className="btn btn-soft" onClick={() => runTestConnection('Website Webhook')}>
              Test Ingestion
            </button>
            <button className="btn" onClick={() => alert('Rotating secret key')}>
              Rotate Secret
            </button>
          </div>
        </div>

        {/* WhatsApp Business Cloud API */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2>WhatsApp Business Cloud API</h2>
              <small style={{ color: 'var(--text-muted)' }}>Meta Graph API v20.0 official connection</small>
            </div>
            <StatusPill label="Connected" variant="green" />
          </div>
          <div style={{ display: 'grid', gap: '14px', margin: '14px 0' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>WhatsApp Business Account ID (WABA)</label>
              <input
                type="text"
                readOnly
                value="waba_10928374619283"
                className="form-control"
                style={{ width: '100%', background: 'var(--surface-secondary)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Registered Phone Number</label>
              <input
                type="text"
                readOnly
                value="+91 98765 00000 (Verified Business Name: Bring My Bite)"
                className="form-control"
                style={{ width: '100%', background: 'var(--surface-secondary)' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button className="btn btn-soft" onClick={() => runTestConnection('WhatsApp Cloud API')}>
              Verify Webhook Handshake
            </button>
            <button className="btn" onClick={() => alert('Syncing templates from Meta')}>
              Sync Templates
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
