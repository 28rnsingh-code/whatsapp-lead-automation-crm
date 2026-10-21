import React, { useState, useEffect } from 'react';
import { StatusPill } from '../components/StatusPill';
import {
  fetchWhatsAppConfigApi,
  fetchWhatsAppMessagesApi,
  sendWhatsAppMessageApi,
  fetchWhatsAppTemplatesApi,
  fetchLeadsApi,
  generateAiReplyApi,
  approveAiReplyApi,
  WhatsAppConfigResponse,
  WhatsAppMessageItem,
  GenerateAiReplyResponse,
} from '../services/api';
import { Lead } from '../types';

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

  // Load messages for currently selected lead
  useEffect(() => {
    if (!selectedLead) return;
    fetchWhatsAppMessagesApi(selectedLead.phoneRaw, selectedLead.id)
      .then((msgs) => setMessages(msgs))
      .catch(() => setMessages([]));
  }, [selectedLead]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedLead || !inputMessage.trim() || sending) return;

    setSending(true);
    const textToSend = inputMessage.trim();
    setInputMessage('');

    try {
      const sentMsg = await sendWhatsAppMessageApi({
        recipientPhone: selectedLead.phoneRaw,
        body: textToSend,
        leadId: selectedLead.id,
      });

      setMessages((prev) => [...prev, sentMsg]);
      showToast('Message dispatched to WhatsApp.');
    } catch (err: any) {
      showToast(`Failed to send message: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleSendTemplate = async (templateName: string) => {
    if (!selectedLead) return;
    setSending(true);
    setShowTemplateModal(false);

    try {
      const sentMsg = await sendWhatsAppMessageApi({
        recipientPhone: selectedLead.phoneRaw,
        templateName,
        templateParameters: [selectedLead.name, selectedLead.companyName || 'your business'],
        leadId: selectedLead.id,
      });

      setMessages((prev) => [...prev, sentMsg]);
      showToast(`Template "${templateName}" dispatched successfully.`);
    } catch (err: any) {
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
    return diffHours < 24;
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
      showToast('AI draft generated.');
    } catch (err: any) {
      showToast(`AI generation error: ${err.message}`);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleApproveAiReply = async () => {
    if (!selectedLead || !aiSuggestion || sending) return;
    setSending(true);
    try {
      await approveAiReplyApi({
        recipientPhone: selectedLead.phoneRaw,
        replyText: aiSuggestion.replyText,
        leadId: selectedLead.id,
      });

      const newMsg: WhatsAppMessageItem = {
        id: `w-msg-ai-${Date.now()}`,
        tenantId: selectedLead.tenantId,
        leadId: selectedLead.id,
        senderPhone: '+919999988888',
        recipientPhone: selectedLead.phoneRaw,
        direction: 'outbound',
        messageType: 'text',
        body: aiSuggestion.replyText,
        status: 'sent',
        aiGenerated: true,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);
      setAiSuggestion(null);
      showToast('AI reply approved and sent.');
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
          <strong>🛡️ Provider:</strong> {config?.config.provider === 'cloud_api' ? 'Meta Official Cloud API' : config?.config.provider === 'gupshup' ? 'Gupshup Enterprise' : 'Local Sandbox Adapter'} • Status: <span style={{ fontWeight: 600 }}>{config?.config.status || 'Connected'}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <StatusPill
            label={windowActive ? '24h Window Open' : 'Template Required'}
            variant={windowActive ? 'green' : 'amber'}
          />
          <StatusPill
            label={config?.config.status === 'connected' ? 'Connected' : 'Active'}
            variant="green"
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
                onClick={() => setSelectedLead(lead)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md, 8px)',
                  cursor: 'pointer',
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
                    {selectedLead.phoneRaw} • {selectedLead.companyName || 'Individual'} • <span style={{ color: 'var(--green-text, #027a48)' }}>✓ Opt-in Consented</span>
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
                          {isOutbound && <span>✓✓</span>}
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

                {!windowActive && (
                  <div style={{ fontSize: '11px', color: '#b45309', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>⚠️</span> Customer care window closed (&gt;24h since last inbound). Free-form messages may be blocked by Meta policy; use a pre-approved template.
                  </div>
                )}
                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="input-text"
                    placeholder="Type a WhatsApp message or update…"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    disabled={sending}
                    style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--line)' }}
                  />
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={handleGenerateAiReply}
                    disabled={isGeneratingAi}
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
                    disabled={sending || !inputMessage.trim()}
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
              {templates.map((tpl) => (
                <div
                  key={tpl.name}
                  style={{
                    padding: '14px',
                    borderRadius: '8px',
                    border: '1px solid var(--line)',
                    background: 'var(--surface-secondary)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '13px' }}>{tpl.header || tpl.name}</strong>
                    <StatusPill label={tpl.status} variant="green" />
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text)', marginBottom: '10px' }}>
                    {tpl.body}
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                    onClick={() => handleSendTemplate(tpl.name)}
                    disabled={sending}
                  >
                    Send Template to {selectedLead?.name || 'Contact'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
