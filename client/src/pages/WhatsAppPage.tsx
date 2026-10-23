import React, { useState, useEffect } from 'react';
import { StatusPill } from '../components/StatusPill';
import {
  fetchWhatsAppConfigApi,
  fetchWhatsAppMessagesApi,
  sendWhatsAppMessageApi,
  fetchWhatsAppTemplatesApi,
  fetchLeadsApi,
  generateAiReplyApi,
  WhatsAppConfigResponse,
  WhatsAppMessageItem,
  GenerateAiReplyResponse,
} from '../services/api';
import { Lead } from '../types';

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getTemplateBodyText(template: any): string {
  if (typeof template?.body === 'string') return template.body;
  const body = Array.isArray(template?.components)
    ? template.components.find((component: any) => component.type === 'BODY')
    : undefined;
  return typeof body?.text === 'string' ? body.text : 'Template body preview unavailable.';
}

function getTemplateBodyParameterCount(template: any): number {
  return (getTemplateBodyText(template).match(/\{\{[^{}]+\}\}/g) || []).length;
}

function getTemplateHeaderParameterCount(template: any): number {
  if (typeof template?.header === 'string') {
    return (template.header.match(/\{\{[^{}]+\}\}/g) || []).length;
  }
  const header = Array.isArray(template?.components)
    ? template.components.find((component: any) => component.type === 'HEADER')
    : undefined;
  if (!header) return 0;
  if (header.format && header.format !== 'TEXT') return Number.POSITIVE_INFINITY;
  return typeof header.text === 'string'
    ? (header.text.match(/\{\{[^{}]+\}\}/g) || []).length
    : 0;
}

function suggestedTemplateParameters(count: number, lead: Lead): string[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return lead.name || '';
    if (index === 1) return lead.companyName || 'your business';
    return '';
  });
}


export const WhatsAppPage: React.FC = () => {
  const [config, setConfig] = useState<WhatsAppConfigResponse | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessageItem[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [textIdempotencyKey, setTextIdempotencyKey] = useState<string | null>(null);
  const [templateIdempotencyKeys, setTemplateIdempotencyKeys] = useState<Record<string, string>>({});
  const [templateParametersByName, setTemplateParametersByName] = useState<Record<string, string[]>>({});
  const [aiReplyIdempotencyKey, setAiReplyIdempotencyKey] = useState<string | null>(null);

  // AI Suggestion State
  const [aiSuggestion, setAiSuggestion] = useState<GenerateAiReplyResponse | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [configData, leadsData, templatesData] = await Promise.all([
        fetchWhatsAppConfigApi().catch(() => null),
        fetchLeadsApi({ pageSize: 50 }),
        fetchWhatsAppTemplatesApi().catch(() => []),
      ]);

      if (configData) setConfig(configData);
      setLeads(leadsData);
      setTemplates(templatesData);

      if (leadsData.length > 0 && !selectedLead) {
        setSelectedLead(leadsData[0]);
      }
    } catch (err: any) {
      showToast(`Error loading WhatsApp data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Drafts and in-flight dedupe keys belong to a specific recipient. Never
    // carry a pending message draft into a different lead's conversation.
    setInputMessage('');
    setTextIdempotencyKey(null);
    setAiSuggestion(null);
    setAiReplyIdempotencyKey(null);
  }, [selectedLead?.id]);

  // Load messages for currently selected lead
  useEffect(() => {
    if (!selectedLead) return;
    fetchWhatsAppMessagesApi(selectedLead.phoneRaw, selectedLead.id)
      .then((msgs) => setMessages(msgs))
      .catch(() => setMessages([]));
  }, [selectedLead]);

  const consentIsValid = !!selectedLead &&
    selectedLead.consentStatus === 'Consented' &&
    !!selectedLead.consentSource &&
    !!selectedLead.consentRecordedAt &&
    !selectedLead.optedOutAt;

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedLead || !inputMessage.trim() || sending) return;
    if (!consentIsValid) {
      showToast('Message blocked: record the customer’s explicit WhatsApp consent in Lead Details first.');
      return;
    }
    if (!windowActive) {
      showToast('The 24-hour customer-service window is closed. Use an approved template instead.');
      return;
    }

    setSending(true);
    const textToSend = inputMessage.trim();
    const requestKey = textIdempotencyKey || createIdempotencyKey();
    if (!textIdempotencyKey) setTextIdempotencyKey(requestKey);

    try {
      const sentMsg = await sendWhatsAppMessageApi({
        recipientPhone: selectedLead.phoneRaw,
        body: textToSend,
        leadId: selectedLead.id,
        idempotencyKey: requestKey,
      });

      setMessages((prev) => [...prev.filter((message) => message.id !== sentMsg.id), sentMsg]);
      setInputMessage('');
      setTextIdempotencyKey(null);
      showToast(sentMsg.status === 'queued'
        ? 'Message queued; delivery status is still pending.'
        : `Message accepted by WhatsApp provider (status: ${sentMsg.status}).`);
    } catch (err: any) {
      // Keep both the typed text and the same key for safe retries. Editing the
      // message creates a new key, so retries cannot accidentally reuse a key.
      showToast(`Failed to send message: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleSendTemplate = async (template: any) => {
    if (!selectedLead || sending) return;
    if (!consentIsValid) {
      showToast('Template blocked: record the customer’s explicit WhatsApp consent in Lead Details first.');
      return;
    }
    if (template?.status !== 'APPROVED') {
      showToast('This template is not approved by the configured WhatsApp provider.');
      return;
    }
    if (getTemplateHeaderParameterCount(template) > 0) {
      showToast('This template uses header parameters or media that this release does not support. Choose a compatible approved template.');
      return;
    }

    const templateName = String(template.name || '');
    const templateStateKey = `${selectedLead.id}:${templateName}:${template.language || ''}`;
    if (!templateName) {
      showToast('This template has no provider template name and cannot be sent.');
      return;
    }
    const parameterCount = getTemplateBodyParameterCount(template);
    const initialParameters = suggestedTemplateParameters(parameterCount, selectedLead);
    const parameters = templateParametersByName[templateStateKey] || initialParameters;
    if (parameters.length !== parameterCount || parameters.some((parameter) => !parameter.trim())) {
      showToast(`Fill all ${parameterCount} body parameter(s) before sending this template.`);
      return;
    }

    setSending(true);
    const existingKey = templateIdempotencyKeys[templateStateKey];
    const requestKey = existingKey || createIdempotencyKey();
    if (!existingKey) setTemplateIdempotencyKeys((prev) => ({ ...prev, [templateStateKey]: requestKey }));

    try {
      const sentMsg = await sendWhatsAppMessageApi({
        recipientPhone: selectedLead.phoneRaw,
        templateName,
        templateLanguage: typeof template.language === 'string' ? template.language : undefined,
        templateParameters: parameters,
        leadId: selectedLead.id,
        idempotencyKey: requestKey,
      });
      setMessages((prev) => [...prev.filter((message) => message.id !== sentMsg.id), sentMsg]);
      setTemplateIdempotencyKeys((prev) => {
        const next = { ...prev };
        delete next[templateStateKey];
        return next;
      });
      setShowTemplateModal(false);
      showToast(sentMsg.status === 'queued'
        ? `Template queued; delivery status is pending.`
        : `Template "${templateName}" accepted by WhatsApp (status: ${sentMsg.status}).`);
    } catch (err: any) {
      // Retain the key. If provider acceptance is uncertain, retrying must not
      // create another outbound message.
      showToast(`Failed to dispatch template: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  // Check if 24-hr customer service window is open based on last inbound message
  const is24HourWindowActive = () => {
    const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
    if (!lastInbound) return false;
    const diffHours = (Date.now() - new Date(lastInbound.createdAt).getTime()) / (1000 * 3600);
    return diffHours >= 0 && diffHours < 24;
  };

  const windowActive = is24HourWindowActive();

  const handleGenerateAiReply = async () => {
    if (!selectedLead || isGeneratingAi) return;
    setIsGeneratingAi(true);
    setAiSuggestion(null);

    const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
    const queryText = lastInbound?.body || selectedLead.notes || 'Interested in your services';

    try {
      const res = await generateAiReplyApi({
        incomingMessage: queryText,
        leadName: selectedLead.name,
        companyName: selectedLead.companyName,
      });
      setAiSuggestion(res);
      setAiReplyIdempotencyKey(null);
      showToast('AI draft generated.');
    } catch (err: any) {
      showToast(`AI generation error: ${err.message}`);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleApproveAiReply = async () => {
    if (!selectedLead || !aiSuggestion || sending) return;
    if (!consentIsValid) {
      showToast('AI reply blocked: explicit WhatsApp consent must be recorded first.');
      return;
    }
    if (!windowActive) {
      showToast('The 24-hour window is closed. Use an approved template instead; the AI reply has not been sent.');
      return;
    }

    setSending(true);
    const requestKey = aiReplyIdempotencyKey || createIdempotencyKey();
    if (!aiReplyIdempotencyKey) setAiReplyIdempotencyKey(requestKey);
    try {
      const sentMsg = await sendWhatsAppMessageApi({
        recipientPhone: selectedLead.phoneRaw,
        body: aiSuggestion.replyText,
        leadId: selectedLead.id,
        idempotencyKey: requestKey,
      });
      setMessages((prev) => [...prev.filter((message) => message.id !== sentMsg.id), sentMsg]);
      setAiSuggestion(null);
      setAiReplyIdempotencyKey(null);
      showToast(sentMsg.status === 'queued'
        ? 'AI reply queued; delivery status is pending.'
        : `AI reply accepted by WhatsApp (status: ${sentMsg.status}).`);
    } catch (err: any) {
      showToast(`Approval failed: ${err.message}`);
    } finally {
      setSending(false);
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
          <h1>WhatsApp Inbox (Multi-Provider)</h1>
          <div className="page-header-sub">
            Real-time conversations linked to CRM contact history and opt-in consent.
          </div>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-soft" onClick={() => setShowTemplateModal(true)}>
            📄 Template Library
          </button>
          <button className="btn btn-soft" onClick={loadData} disabled={loading}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Provider & Window Status Banner */}
      <div style={{
        background: 'var(--blue-subtle, #f0f7ff)',
        border: '1px solid var(--blue-border, #d0e7ff)',
        color: 'var(--blue, #155eef)',
        padding: '12px 16px',
        borderRadius: 'var(--radius-card, 12px)',
        marginBottom: '16px',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div>
          <strong>🛡️ Provider:</strong> {config?.config.provider === 'cloud_api' ? 'Meta Official Cloud API' : config?.config.provider === 'gupshup' ? 'Gupshup Enterprise' : config?.config.provider === 'mock' ? 'Local Test Adapter' : 'Not configured'} • Status: <span style={{ fontWeight: 600 }}>{config?.config.status || 'Not configured'}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <StatusPill
            label={windowActive ? '24h Window Open' : 'Template Required'}
            variant={windowActive ? 'green' : 'amber'}
          />
          <StatusPill
            label={config?.config.status === 'connected' ? 'Connected' : config?.config.status === 'error' ? 'Error' : 'Not configured'}
            variant={config?.config.status === 'connected' ? 'green' : config?.config.status === 'error' ? 'red' : 'amber'}
          />
        </div>
      </div>

      {/* WhatsApp Split Inbox Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '16px', height: '620px' }}>
        {/* Left: Contact / Lead Thread List */}
        <div className="card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', paddingBottom: '6px' }}>
            ACTIVE LEAD THREADS ({leads.length})
          </div>
          {leads.map((lead) => {
            const isSelected = selectedLead?.id === lead.id;
            return (
              <div
                key={lead.id}
                onClick={() => {
                  if (!sending) setSelectedLead(lead);
                }}
                aria-disabled={sending}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md, 8px)',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  background: isSelected ? 'var(--surface-secondary, #f8faff)' : 'var(--surface, #ffffff)',
                  border: isSelected ? '1px solid var(--blue, #155eef)' : '1px solid var(--line, #e1e9f5)',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <strong style={{ fontSize: '13px' }}>{lead.name}</strong>
                  <small style={{ color: 'var(--text-muted)' }}>{lead.source}</small>
                </div>
                <small style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  {lead.companyName || lead.phoneRaw}
                </small>
                <div style={{ fontSize: '11px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {lead.notes || 'Click to view conversation history'}
                </div>
              </div>
            );
          })}

          {leads.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
              No leads registered yet.
            </div>
          )}
        </div>

        {/* Right: Messages Area & Composer */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
          {selectedLead ? (
            <>
              {/* Thread Header */}
              <div style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--line, #e1e9f5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--surface, #ffffff)',
              }}>
                <div>
                  <strong style={{ fontSize: '15px' }}>{selectedLead.name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                    {selectedLead.phoneRaw} • {selectedLead.companyName || 'Individual'} • <span style={{ color: consentIsValid ? 'var(--green-text, #027a48)' : 'var(--red-text, #b42318)' }}>{consentIsValid ? '✓ Consent recorded' : selectedLead.consentStatus === 'Opted Out' || selectedLead.optedOutAt ? 'Opted out — messaging blocked' : 'Consent evidence missing — messaging blocked'}</span>
                  </small>
                </div>
                <div>
                  <StatusPill
                    label={windowActive ? '24h Window Open' : 'Session Expired'}
                    variant={windowActive ? 'green' : 'amber'}
                  />
                </div>
              </div>

              {/* Message History */}
              <div style={{
                flex: 1,
                padding: '20px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                background: 'var(--surface-secondary, #f8faff)',
              }}>
                {messages.length > 0 ? (
                  messages.map((m) => {
                    const isOutbound = m.direction === 'outbound';
                    return (
                      <div
                        key={m.id}
                        style={{
                          alignSelf: isOutbound ? 'flex-end' : 'flex-start',
                          maxWidth: '75%',
                          background: isOutbound ? 'var(--blue, #155eef)' : 'var(--surface, #ffffff)',
                          color: isOutbound ? '#ffffff' : 'var(--text, #14213d)',
                          padding: '10px 14px',
                          borderRadius: '12px',
                          border: isOutbound ? 'none' : '1px solid var(--line, #e1e9f5)',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        }}
                      >
                        <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>{m.body}</div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          gap: '4px',
                          color: isOutbound ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                          marginTop: '4px',
                          fontSize: '10px',
                        }}>
                          <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isOutbound && <span>{m.status}</span>}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ textAlign: 'center', margin: 'auto', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No messages recorded with this contact yet.<br />
                    Use the composer below or pick a template from the Template Library.
                  </div>
                )}
              </div>

              {/* Message Composer */}
              <div style={{ padding: '14px', borderTop: '1px solid var(--line, #e1e9f5)', background: 'var(--surface, #ffffff)' }}>
                {/* AI Suggestion Banner */}
                {aiSuggestion && (
                  <div style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#f5f3ff',
                    border: '1px solid #ddd6fe',
                    marginBottom: '10px',
                    fontSize: '12px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>✨</span> AI Suggestion ({aiSuggestion.model} • {Math.round(aiSuggestion.confidence * 100)}% confidence)
                      </span>
                      <button
                        type="button"
                        className="btn btn-soft"
                        style={{ padding: '2px 6px', fontSize: '10px' }}
                        onClick={() => setAiSuggestion(null)}
                      >
                        ✕ Dismiss
                      </button>
                    </div>
                    <div style={{ color: '#1e1b4b', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>
                      {aiSuggestion.replyText}
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-soft"
                        style={{ fontSize: '11px', padding: '3px 8px' }}
                        onClick={() => {
                          setInputMessage(aiSuggestion.replyText);
                          setAiSuggestion(null);
                        }}
                      >
                        📝 Insert into Composer
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: '11px', padding: '3px 10px', backgroundColor: '#7c3aed' }}
                        onClick={handleApproveAiReply}
                        disabled={sending}
                      >
                        {sending ? 'Sending…' : '✓ Approve & Send Now'}
                      </button>
                    </div>
                  </div>
                )}

                {!consentIsValid && (
                  <div role="alert" style={{ fontSize: '11px', color: '#b42318', marginBottom: '8px' }}>
                    WhatsApp sending is blocked until explicit consent evidence is recorded in the lead record and the customer has not opted out.
                  </div>
                )}
                {!windowActive && (
                  <div style={{ fontSize: '11px', color: '#b45309', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>⚠️</span> Customer-service window closed (&gt;24h since the last inbound message). Free-form sends are disabled; choose an approved template.
                  </div>
                )}
                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="input-text"
                    placeholder="Type a WhatsApp message or update…"
                    value={inputMessage}
                    onChange={(e) => {
                      if (e.target.value !== inputMessage) setTextIdempotencyKey(null);
                      setInputMessage(e.target.value);
                    }}
                    disabled={sending || !consentIsValid}
                    style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--line)' }}
                  />
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={handleGenerateAiReply}
                    disabled={isGeneratingAi || !consentIsValid}
                    style={{ padding: '0 10px', color: '#6d28d9', borderColor: '#ddd6fe' }}
                    title="Generate AI response"
                  >
                    {isGeneratingAi ? '✨ Thinking…' : '✨ AI Reply'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => setShowTemplateModal(true)}
                    style={{ padding: '0 12px' }}
                    title="Choose from approved templates"
                  >
                    Template
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={sending || !inputMessage.trim() || !consentIsValid || !windowActive}
                    style={{ minWidth: '80px' }}
                  >
                    {sending ? 'Sending…' : 'Send →'}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', margin: 'auto', color: 'var(--text-muted)' }}>
              Select a conversation thread to view message history.
            </div>
          )}
        </div>
      </div>

      {/* Template Selection Modal */}
      {showTemplateModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div className="card" style={{ width: '540px', maxWidth: '90vw', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Approved WhatsApp Templates</h2>
              <button
                className="btn btn-soft"
                onClick={() => setShowTemplateModal(false)}
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Pre-approved Meta templates can be sent outside the 24-hour customer service window.
            </p>

            <div style={{ display: 'grid', gap: '12px', maxHeight: '360px', overflowY: 'auto' }}>
              {templates.length === 0 && (
                <p role="status" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  No template records are available. Refresh the page after configuring the provider, or check the integration error.
                </p>
              )}
              {templates.map((tpl) => {
                const bodyText = getTemplateBodyText(tpl);
                const parameterCount = getTemplateBodyParameterCount(tpl);
                const defaults = selectedLead ? suggestedTemplateParameters(parameterCount, selectedLead) : [];
                const templateStateKey = `${selectedLead?.id || 'none'}:${tpl.name}:${tpl.language || ''}`;
                const parameters = templateParametersByName[templateStateKey] || defaults;
                const approved = tpl.status === 'APPROVED';
                const unsupportedHeader = getTemplateHeaderParameterCount(tpl) > 0;
                return (
                  <div
                    key={`${tpl.name}-${tpl.language || ''}`}
                    style={{
                      padding: '14px',
                      borderRadius: '8px',
                      border: '1px solid var(--line)',
                      background: 'var(--surface-secondary)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
                      <strong style={{ fontSize: '13px' }}>{tpl.header || tpl.name}</strong>
                      <StatusPill
                        label={tpl.status || 'Status unknown'}
                        variant={approved ? 'green' : tpl.status === 'REJECTED' ? 'red' : 'amber'}
                      />
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text)', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>
                      {bodyText}
                    </div>
                    <small style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      Language: {tpl.language || 'unknown'} • {tpl.category || 'category unknown'}
                    </small>
                    {parameterCount > 0 && (
                      <div style={{ display: 'grid', gap: '8px', marginBottom: '10px' }}>
                        {Array.from({ length: parameterCount }, (_, index) => (
                          <div key={index}>
                            <label htmlFor={`template-${encodeURIComponent(templateStateKey)}-param-${index}`} style={{ display: 'block', fontSize: '11px', fontWeight: 600, marginBottom: '3px' }}>
                              Body parameter {index + 1}
                            </label>
                            <input
                              id={`template-${encodeURIComponent(templateStateKey)}-param-${index}`}
                              className="form-control"
                              value={parameters[index] ?? ''}
                              onChange={(e) => {
                                const next = [...parameters];
                                next[index] = e.target.value;
                                setTemplateParametersByName((prev) => ({ ...prev, [templateStateKey]: next }));
                              }}
                              disabled={sending || !approved}
                              style={{ width: '100%' }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {unsupportedHeader && (
                      <p role="alert" style={{ color: '#b42318', fontSize: '11px' }}>
                        This template uses an unsupported header variable or media. Choose a compatible text-header template.
                      </p>
                    )}
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                      onClick={() => void handleSendTemplate(tpl)}
                      disabled={sending || !approved || !consentIsValid || unsupportedHeader}
                    >
                      {sending ? 'Sending…' : `Send approved template to ${selectedLead?.name || 'Contact'}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
