import React, { useState, useEffect } from 'react';
import {
  fetchWhatsAppConfigApi,
  updateWhatsAppConfigApi,
  fetchAiConfigApi,
  updateAiConfigApi,
  fetchSubscriptionApi,
  fetchBillingPlansApi,
  changePlanApi,
  fetchTenantUsageApi,
  WhatsAppConfigResponse,
  AiConfigResponse,
} from '../services/api';
import { StatusPill } from '../components/StatusPill';

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'general' | 'pipeline' | 'whatsapp' | 'ai' | 'billing' | 'notifications'>('general');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // WhatsApp Provider Form State
  const [waConfig, setWaConfig] = useState<WhatsAppConfigResponse | null>(null);
  const [waProvider, setWaProvider] = useState<string>('cloud_api');
  const [waPhoneId, setWaPhoneId] = useState<string>('');
  const [waAccountId, setWaAccountId] = useState<string>('');
  const [waAccessToken, setWaAccessToken] = useState<string>('');
  const [waAppSecret, setWaAppSecret] = useState<string>('');
  const [waWebhookVerifyToken, setWaWebhookVerifyToken] = useState<string>('');
  const [waSaving, setWaSaving] = useState<boolean>(false);

  // AI Auto-Reply Form State
  const [aiConfig, setAiConfig] = useState<AiConfigResponse | null>(null);
  const [aiProvider, setAiProvider] = useState<string>('openai');
  const [aiApiKey, setAiApiKey] = useState<string>('');
  const [aiModel, setAiModel] = useState<string>('gpt-4o-mini');
  const [aiMode, setAiMode] = useState<string>('draft_only');
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiContext, setAiContext] = useState<string>('');
  const [aiMaxChars, setAiMaxChars] = useState<number>(250);
  const [aiConfidence, setAiConfidence] = useState<number>(0.8);
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [aiSaving, setAiSaving] = useState<boolean>(false);

  // SaaS Subscription & Billing State
  const [subscription, setSubscription] = useState<any>(null);
  const [billingPlans, setBillingPlans] = useState<any[]>([]);
  const [tenantUsage, setTenantUsage] = useState<any>(null);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  useEffect(() => {
    // Load WhatsApp configuration
    fetchWhatsAppConfigApi()
      .then((data) => {
        setWaConfig(data);
        if (data.config) {
          setWaProvider(data.config.provider || 'cloud_api');
          setWaPhoneId(data.config.phoneNumberId || '');
          setWaAccountId(data.config.businessAccountId || '');
        }
      })
      .catch(() => {});

    // Load AI configuration
    fetchAiConfigApi()
      .then((data) => {
        setAiConfig(data);
        if (data.config) {
          setAiProvider(data.config.provider || 'openai');
          setAiModel(data.config.model || 'gpt-4o-mini');
          setAiMode(data.config.mode || 'draft_only');
          setAiPrompt(data.config.systemPrompt || '');
          setAiContext(data.config.businessContext || '');
          setAiMaxChars(data.config.maxOutputChars || 250);
          setAiConfidence(data.config.confidenceThreshold || 0.8);
          setAiEnabled(data.config.enabled);
        }
      })
      .catch(() => {});

    // Load Billing & Subscription
    Promise.all([
      fetchSubscriptionApi().catch(() => null),
      fetchBillingPlansApi().catch(() => []),
      fetchTenantUsageApi().catch(() => null),
    ]).then(([subData, plansData, usageData]) => {
      if (subData) setSubscription(subData);
      if (plansData) setBillingPlans(plansData);
      if (usageData) setTenantUsage(usageData);
    });
  }, []);

  const handleSelectPlan = async (planId: string) => {
    if (changingPlanId) return;
    setChangingPlanId(planId);
    try {
      const res = await changePlanApi(planId);
      if (res?.data) {
        setSubscription(res.data);
      }
      showToast(`Subscription plan switched to "${planId.toUpperCase()}"!`);
      // Refresh usage & subscription
      const [freshSub, freshUsage] = await Promise.all([
        fetchSubscriptionApi().catch(() => null),
        fetchTenantUsageApi().catch(() => null),
      ]);
      if (freshSub) setSubscription(freshSub);
      if (freshUsage) setTenantUsage(freshUsage);
    } catch (err: any) {
      showToast(`Failed to update plan: ${err.message}`);
    } finally {
      setChangingPlanId(null);
    }
  };

  const handleSaveWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaSaving(true);
    try {
      const res = await updateWhatsAppConfigApi({
        provider: waProvider,
        phoneNumberId: waPhoneId,
        businessAccountId: waAccountId,
        accessToken: waAccessToken || undefined,
        appSecret: waAppSecret || undefined,
        webhookVerifyToken: waWebhookVerifyToken || undefined,
      });

      if (res.data?.config) {
        setWaConfig((prev) => (prev ? { ...prev, config: res.data.config } : prev));
      }
      showToast('Provider credentials were verified and the configuration was saved.');
      setWaAccessToken('');
      setWaAppSecret('');
      setWaWebhookVerifyToken('');
    } catch (err: any) {
      showToast(`Error saving WhatsApp config: ${err.message}`);
    } finally {
      setWaSaving(false);
    }
  };

  const handleSaveAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiSaving(true);
    try {
      const res = await updateAiConfigApi({
        provider: aiProvider,
        apiKey: aiApiKey || undefined,
        model: aiModel,
        mode: aiMode,
        systemPrompt: aiPrompt,
        businessContext: aiContext,
        maxOutputChars: aiMaxChars,
        confidenceThreshold: aiConfidence,
        enabled: aiEnabled,
      });

      if (res.data?.config) {
        setAiConfig((prev) => (prev ? { ...prev, config: res.data.config } : prev));
      }
      showToast('AI Auto-reply settings saved successfully!');
      setAiApiKey('');
    } catch (err: any) {
      showToast(`Error saving AI config: ${err.message}`);
    } finally {
      setAiSaving(false);
    }
  };

  return (
    <div>
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: '#1e293b',
          color: '#ffffff',
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🔔</span> {toastMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Workspace Settings</h1>
          <div className="page-header-sub">
            Configure regional localization, WhatsApp providers, customer AI models, and notifications.
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--line)', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { id: 'general', label: 'General & Localization' },
          { id: 'whatsapp', label: 'WhatsApp Provider' },
          { id: 'ai', label: 'AI Auto-Reply' },
          { id: 'billing', label: 'Subscription & Plans' },
          { id: 'pipeline', label: 'Pipeline Stages' },
          { id: 'notifications', label: 'Notification Rules' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              background: 'transparent',
              border: 0,
              padding: '10px 16px',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? 'var(--blue)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--blue)' : '2px solid transparent',
              fontSize: '13px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 1. General Tab */}
      {activeTab === 'general' && (
        <div className="card" style={{ maxWidth: '640px' }}>
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Workspace Name</label>
              <input type="text" defaultValue="Bring My Bite" className="input-text" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Default Currency</label>
              <select className="input-select" style={{ width: '100%' }} defaultValue="INR">
                <option value="INR">INR — Indian Rupee (₹)</option>
                <option value="USD">USD — US Dollar ($)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>Workspace Timezone</label>
              <select className="input-select" style={{ width: '100%' }} defaultValue="Asia/Kolkata">
                <option value="Asia/Kolkata">Asia/Kolkata (IST — UTC+05:30)</option>
                <option value="UTC">UTC (Coordinated Universal Time)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* 2. WhatsApp Provider Integration Tab */}
      {activeTab === 'whatsapp' && (
        <div className="card" style={{ maxWidth: '720px' }}>
          <div className="card-header">
            <div>
              <h2>WhatsApp Business API Provider</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Bring your own WhatsApp Business API account. Tokens are encrypted at rest with AES-256.
              </p>
            </div>
            {waConfig?.config.status && (
              <StatusPill
                label={waConfig.config.status === 'connected' ? 'Connected' : 'Unconfigured'}
                variant={waConfig.config.status === 'connected' ? 'green' : 'amber'}
              />
            )}
          </div>

          <form onSubmit={handleSaveWhatsApp} style={{ display: 'grid', gap: '16px', marginTop: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                WhatsApp Provider
              </label>
              <select
                className="input-select"
                value={waProvider}
                onChange={(e) => setWaProvider(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="cloud_api">Meta Official WhatsApp Cloud API (Recommended)</option>
                <option value="gupshup">Gupshup Enterprise WhatsApp API</option>
                <option value="twilio">Twilio WhatsApp API</option>
                <option value="mock">Local Test Mock Adapter (Sandbox)</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                  Phone Number ID
                </label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="e.g. 109823475689123"
                  value={waPhoneId}
                  onChange={(e) => setWaPhoneId(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                  WABA Business Account ID
                </label>
                <input
                  type="text"
                  className="input-text"
                  placeholder="e.g. 209384756192834"
                  value={waAccountId}
                  onChange={(e) => setWaAccountId(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Permanent Access Token / API Key
              </label>
              <input
                type="password"
                className="input-text"
                placeholder={waConfig?.config.accessTokenMasked || 'Enter new access token to update…'}
                value={waAccessToken}
                onChange={(e) => setWaAccessToken(e.target.value)}
                style={{ width: '100%' }}
              />
              <small style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                Stored credentials: {waConfig?.config.accessTokenMasked ? <code>{waConfig.config.accessTokenMasked}</code> : 'None configured yet'}
              </small>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Meta App Secret (for HMAC Webhook Verification)
              </label>
              <input
                type="password"
                className="input-text"
                placeholder={waConfig?.config.appSecretMasked || 'Enter app secret…'}
                value={waAppSecret}
                onChange={(e) => setWaAppSecret(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Meta Webhook Verify Token
              </label>
              <input
                type="password"
                className="input-text"
                placeholder={waConfig?.config.webhookVerifyTokenMasked || 'Enter a private verify token you also configure in Meta…'}
                value={waWebhookVerifyToken}
                onChange={(e) => setWaWebhookVerifyToken(e.target.value)}
                style={{ width: '100%' }}
              />
              <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                This token must match the verify token configured in Meta. It is separate from the App Secret used to verify webhook signatures.
              </small>
            </div>

            {waConfig?.webhookUrl && (
              <div style={{ background: 'var(--surface-secondary)', padding: '12px 14px', borderRadius: '8px', fontSize: '12px' }}>
                <strong style={{ display: 'block', marginBottom: '4px' }}>Webhook Inbound URL for Meta Dashboard:</strong>
                <code style={{ fontSize: '11px', wordBreak: 'break-all', color: 'var(--blue)' }}>
                  {waConfig.webhookUrl}
                </code>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={waSaving}>
                {waSaving ? 'Verifying & Saving…' : 'Save & Test Provider Connection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 3. AI Auto-Reply Tab */}
      {activeTab === 'ai' && (
        <div className="card" style={{ maxWidth: '720px' }}>
          <div className="card-header">
            <div>
              <h2>AI Auto-Reply Configuration</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Select your own AI provider, set safe reply boundaries, and draft responses automatically.
              </p>
            </div>
            <StatusPill
              label={aiEnabled ? (aiConfig?.config.status === 'active' ? 'AI Active' : 'Configured') : 'Disabled'}
              variant={aiEnabled ? 'green' : 'gray' as any}
            />
          </div>

          <form onSubmit={handleSaveAi} style={{ display: 'grid', gap: '16px', marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="aiEnabledCheck"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="aiEnabledCheck" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                Enable AI Auto-Reply for this Tenant
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                  AI Provider
                </label>
                <select
                  className="input-select"
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="openai">OpenAI (ChatGPT)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="mock">Local Sandbox AI (Mock)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                  Model Selection
                </label>
                <select
                  className="input-select"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {aiProvider === 'openai' && (
                    <>
                      <option value="gpt-4o-mini">gpt-4o-mini (Fast & Cost Effective)</option>
                      <option value="gpt-4o">gpt-4o (High Intelligence)</option>
                      <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                    </>
                  )}
                  {aiProvider === 'gemini' && (
                    <>
                      <option value="gemini-1.5-flash">gemini-1.5-flash (Fast & Accurate)</option>
                      <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                    </>
                  )}
                  {aiProvider === 'mock' && (
                    <>
                      <option value="mock-fast-reply">mock-fast-reply</option>
                      <option value="mock-smart-assistant">mock-smart-assistant</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Provider API Key
              </label>
              <input
                type="password"
                className="input-text"
                placeholder={aiConfig?.config.apiKeyMasked || 'Enter API key (e.g. sk-...)…'}
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                style={{ width: '100%' }}
              />
              <small style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                Stored API Key: {aiConfig?.config.apiKeyMasked ? <code>{aiConfig.config.apiKeyMasked}</code> : 'None configured'}
              </small>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Operational Mode & Safety Guardrails
              </label>
              <select
                className="input-select"
                value={aiMode}
                onChange={(e) => setAiMode(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="draft_only">Draft Only — Generate AI reply in composer for agent review</option>
                <option value="approval_before_send">Approval Required — Show Approve & Send button before dispatch</option>
                <option value="automatic_send" disabled>Automatic Send — unavailable until inbound automation and safe retry handling are implemented (Strict Consent Only)</option>
                <option value="disabled">Disabled — Manual agent responses only</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                System Persona Prompt
              </label>
              <textarea
                className="input-text"
                rows={3}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. You are a friendly sales advisor for our CRM company. Reply politely and concisely."
                style={{ width: '100%', fontFamily: 'inherit' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Business Context & FAQs (Knowledge Base)
              </label>
              <textarea
                className="input-text"
                rows={3}
                value={aiContext}
                onChange={(e) => setAiContext(e.target.value)}
                placeholder="e.g. Operating hours: 9 AM - 6 PM IST. Pricing plans: Starter (₹2,999/mo), Growth (₹7,999/mo)."
                style={{ width: '100%', fontFamily: 'inherit' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                  Max Response Length ({aiMaxChars} chars)
                </label>
                <input
                  type="range"
                  min="100"
                  max="600"
                  step="25"
                  value={aiMaxChars}
                  onChange={(e) => setAiMaxChars(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                  Minimum Confidence Threshold ({Math.round(aiConfidence * 100)}%)
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="0.95"
                  step="0.05"
                  value={aiConfidence}
                  onChange={(e) => setAiConfidence(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={aiSaving}>
                {aiSaving ? 'Saving…' : 'Save AI Auto-Reply Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. Pipeline Stages Tab */}
      {activeTab === 'pipeline' && (
        <div className="card" style={{ maxWidth: '720px' }}>
          <div className="card-header">
            <h2>Configured Pipeline Stages</h2>
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            {[
              { name: 'New', order: 1, color: '#155eef', winLoss: 'In Progress' },
              { name: 'Contacted', order: 2, color: '#2e90fa', winLoss: 'In Progress' },
              { name: 'Qualified', order: 3, color: '#7a5af8', winLoss: 'In Progress' },
              { name: 'Proposal', order: 4, color: '#f79009', winLoss: 'In Progress' },
              { name: 'Won', order: 5, color: '#12b76a', winLoss: 'Won (Terminal)' },
              { name: 'Lost', order: 6, color: '#f04438', winLoss: 'Lost (Terminal)' },
            ].map((st) => (
              <div key={st.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: st.color }} />
                  <strong>{st.name}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sort Order: {st.order}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {st.winLoss}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Subscription & SaaS Plans Tab */}
      {activeTab === 'billing' && (
        <div style={{ display: 'grid', gap: '20px', maxWidth: '980px' }}>
          {/* Active Subscription Overview Card */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0 }}>Current Subscription Status</h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Workspace billing tier and real-time resource entitlements.
                </div>
              </div>
              <StatusPill
                label={(subscription?.status || 'active').toUpperCase()}
                variant={
                  subscription?.status === 'active' || subscription?.status === 'trial'
                    ? 'green'
                    : subscription?.status === 'past_due'
                    ? 'amber'
                    : 'red'
                }
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '16px' }}>
              <div style={{ padding: '14px', backgroundColor: 'var(--bg-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Active Tier</span>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px', color: 'var(--blue)' }}>
                  {subscription?.planName || 'Growth Tier'}
                </div>
                <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  Renews: {new Date(subscription?.currentPeriodEnd || Date.now() + 30 * 86400000).toLocaleDateString()}
                </small>
              </div>

              <div style={{ padding: '14px', backgroundColor: 'var(--bg-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Leads Stored</span>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>
                  {tenantUsage?.usage?.leadsCount ?? 4} / {(tenantUsage?.usage?.maxLeads ?? 10000).toLocaleString()}
                </div>
                <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--line)', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, tenantUsage?.usage?.leadsPct ?? 2)}%`, height: '100%', backgroundColor: 'var(--blue)' }} />
                </div>
              </div>

              <div style={{ padding: '14px', backgroundColor: 'var(--bg-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>WhatsApp Outbound Quota</span>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>
                  {tenantUsage?.usage?.messagesCount ?? 8} / {(tenantUsage?.usage?.maxMessages ?? 10000).toLocaleString()}
                </div>
                <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--line)', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, tenantUsage?.usage?.messagesPct ?? 1)}%`, height: '100%', backgroundColor: '#12b76a' }} />
                </div>
              </div>

              <div style={{ padding: '14px', backgroundColor: 'var(--bg-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>AI Tokens Meter</span>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '4px' }}>
                  {(tenantUsage?.usage?.aiTokensCount ?? 120).toLocaleString()} / {(tenantUsage?.usage?.maxAiTokens ?? 100000).toLocaleString()}
                </div>
                <small style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  Auto-refreshes every billing cycle
                </small>
              </div>
            </div>
          </div>

          {/* SaaS Tier Comparison Cards */}
          <div>
            <h3 style={{ marginBottom: '12px', fontSize: '16px' }}>Available SaaS Subscription Tiers</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {[
                {
                  id: 'starter',
                  name: 'Starter Tier',
                  price: '₹1,499',
                  period: '/ month',
                  leads: '1,000 Leads',
                  messages: '1,000 WhatsApp Outbound',
                  ai: 'Mock AI & BYO Key',
                  features: ['Single-user workspace', 'Basic CSV Import', 'Manual Follow-ups', 'Community Support'],
                },
                {
                  id: 'growth',
                  name: 'Growth Tier',
                  price: '₹3,999',
                  period: '/ month',
                  leads: '10,000 Leads',
                  messages: '10,000 WhatsApp Outbound',
                  ai: 'OpenAI + Gemini Auto-Reply',
                  features: ['10 Team Members', 'Excel & CSV Bulk Import/Export', 'Automated Lead Qualification', 'Priority WhatsApp Delivery'],
                  popular: true,
                },
                {
                  id: 'enterprise',
                  name: 'Enterprise Tier',
                  price: '₹9,999',
                  period: '/ month',
                  leads: 'Unlimited Leads',
                  messages: '50,000 WhatsApp Outbound',
                  ai: 'Dedicated AI High Throughput',
                  features: ['Unlimited Seats', 'Custom Pipeline Stages', 'Custom SLA & Dedicated Support', 'Multi-tenant API Access'],
                },
              ].map((tier) => {
                const isCurrent = (subscription?.planId || 'growth') === tier.id;
                return (
                  <div
                    key={tier.id}
                    className="card"
                    style={{
                      border: tier.popular ? '2px solid var(--blue)' : '1px solid var(--line)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    {tier.popular && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '-10px',
                          right: '20px',
                          backgroundColor: 'var(--blue)',
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '12px',
                        }}
                      >
                        MOST POPULAR
                      </span>
                    )}

                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 700 }}>{tier.name}</div>
                      <div style={{ marginTop: '8px', marginBottom: '14px' }}>
                        <span style={{ fontSize: '26px', fontWeight: 800 }}>{tier.price}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}> {tier.period}</span>
                      </div>

                      <div style={{ padding: '8px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', marginBottom: '14px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>📊 {tier.leads}</div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', marginTop: '4px' }}>💬 {tier.messages}</div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', marginTop: '4px' }}>🤖 {tier.ai}</div>
                      </div>

                      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {tier.features.map((f, i) => (
                          <li key={i} style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#12b76a', fontWeight: 700 }}>✓</span> {f}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      className={`btn ${isCurrent ? 'btn-soft' : 'btn-primary'}`}
                      disabled={isCurrent || changingPlanId === tier.id}
                      onClick={() => handleSelectPlan(tier.id)}
                      style={{ width: '100%', marginTop: '10px' }}
                    >
                      {changingPlanId === tier.id ? 'Switching…' : isCurrent ? '✓ Current Plan' : 'Select Plan'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment & Security Notice */}
          <div style={{ padding: '14px 18px', backgroundColor: 'var(--bg-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--line)', fontSize: '12px', color: 'var(--text-muted)' }}>
            <strong>🛡️ SaaS Sandbox Notice:</strong> This tenant workspace is operating in commercial readiness test mode. Plan upgrades and subscription states update server entitlements without charging live cards or bank accounts. Real payment webhook verification is handled via idempotent HMAC contracts.
          </div>
        </div>
      )}

      {/* 6. Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="card" style={{ maxWidth: '640px' }}>
          <div style={{ display: 'grid', gap: '14px' }}>
            {[
              { title: 'Inbound Lead Alerts', desc: 'Notify immediately when a new website or WhatsApp lead arrives.' },
              { title: 'Task Overdue Escalation', desc: 'Send daily reminder at 09:00 AM for follow-ups due today or overdue.' },
              { title: 'Deal Won Celebrations', desc: 'Notify the whole team when a deal is marked Won in the sales pipeline.' },
            ].map((n) => (
              <div key={n.title} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <strong style={{ display: 'block', fontSize: '13px' }}>{n.title}</strong>
                  <small style={{ color: 'var(--text-muted)' }}>{n.desc}</small>
                </div>
                <input type="checkbox" defaultChecked style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
