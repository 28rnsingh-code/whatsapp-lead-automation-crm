import React, { useEffect, useRef, useState } from 'react';
import { StatusPill } from './StatusPill';
import { Lead } from '../types';
import { fetchLeadByIdApi, updateLeadApi, addLeadActivityApi, deleteLeadApi } from '../services/api';

export interface LeadDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onLeadUpdated?: (updated: Lead) => void;
  onLeadDeleted?: (id: string) => void;
}

export const LeadDetailModal: React.FC<LeadDetailModalProps> = ({
  isOpen,
  onClose,
  lead: initialLead,
  onLeadUpdated,
  onLeadDeleted,
}) => {
  const [lead, setLead] = useState<Lead | null>(initialLead);
  const [isLoadingFresh, setIsLoadingFresh] = useState<boolean>(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [newNote, setNewNote] = useState<string>('');
  const [isAddingNote, setIsAddingNote] = useState<boolean>(false);
  const [isUpdatingStage, setIsUpdatingStage] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  // Sync state when initial lead changes and fetch fresh details & activity history from PostgreSQL
  useEffect(() => {
    setLead(initialLead);
    if (isOpen && initialLead?.id) {
      let isCancelled = false;
      setIsLoadingFresh(true);
      fetchLeadByIdApi(initialLead.id)
        .then((fresh) => {
          if (!isCancelled) setLead(fresh);
        })
        .catch((err) => {
          console.warn('[LeadDetailModal] Could not refresh full lead details:', err.message);
        })
        .finally(() => {
          if (!isCancelled) setIsLoadingFresh(false);
        });

      return () => {
        isCancelled = true;
      };
    }
  }, [isOpen, initialLead]);

  // Focus management and Escape key handling
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      // Accessible focus placement
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !lead) return null;

  const handleStageChange = async (newStageName: string) => {
    if (!lead || isUpdatingStage) return;
    setIsUpdatingStage(true);
    setActionMessage(null);
    try {
      const updated = await updateLeadApi(lead.id, { stageId: newStageName });
      setLead(updated);
      if (onLeadUpdated) onLeadUpdated(updated);
      setActionMessage(`✓ Stage updated to "${newStageName}"`);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      setActionMessage(`⚠️ Failed to update stage: ${err.message}`);
    } finally {
      setIsUpdatingStage(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !newNote.trim() || isAddingNote) return;
    setIsAddingNote(true);
    setActionMessage(null);
    try {
      const newActivity = await addLeadActivityApi(lead.id, newNote.trim(), 'note_added');
      setLead((prev) => prev ? {
        ...prev,
        activities: [newActivity, ...(prev.activities || [])],
      } : null);
      setNewNote('');
      setActionMessage('✓ Note added to timeline');
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      setActionMessage(`⚠️ Failed to add note: ${err.message}`);
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleDeleteLead = async () => {
    if (!lead) return;
    try {
      await deleteLeadApi(lead.id);
      if (onLeadDeleted) onLeadDeleted(lead.id);
      onClose();
    } catch (err: any) {
      setActionMessage(`⚠️ Failed to delete lead: ${err.message}`);
    }
  };

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2500);
  };

  // Helper to format values or display "Not provided"
  const renderValue = (val?: string | number | null, fallback = 'Not provided') => {
    if (val === undefined || val === null || val === '') {
      return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{fallback}</span>;
    }
    return <span>{val}</span>;
  };

  // Format date helper
  const formatDate = (isoString?: string) => {
    if (!isoString) return renderValue(null);
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return renderValue(null);
      return d.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return renderValue(null);
    }
  };

  const getStageVariant = (stage?: string) => {
    switch (stage) {
      case 'New': return 'blue';
      case 'Contacted': return 'blue';
      case 'Qualified': return 'purple';
      case 'Proposal': return 'amber';
      case 'Won': return 'green';
      case 'Lost': return 'red';
      default: return 'blue';
    }
  };

  const initials = lead.name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'L';

  const cleanPhoneDigits = (lead.phoneNormalized || lead.phoneRaw || '').replace(/\D/g, '');

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-detail-modal-title"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        ref={modalContainerRef}
        className="modal-content"
        style={{
          maxWidth: '720px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          borderRadius: 'var(--radius-modal, 16px)',
          background: 'var(--surface, #ffffff)',
          border: '1px solid var(--line, #e1e9f5)',
          boxShadow: 'var(--shadow-modal, 0 24px 60px rgba(7, 20, 44, 0.35))',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--line, #e1e9f5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface-secondary, #f8faff)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #155eef 0%, #4f46e5 100%)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(21, 94, 239, 0.3)',
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h2
                  id="lead-detail-modal-title"
                  style={{
                    margin: 0,
                    fontSize: '18px',
                    fontWeight: 700,
                    color: 'var(--text, #14213d)',
                  }}
                >
                  {lead.name}
                </h2>
                <StatusPill
                  label={lead.stageName || 'New'}
                  variant={getStageVariant(lead.stageName)}
                />
                {lead.qualificationStatus && (
                  <span
                    className="pill"
                    style={{
                      background: 'var(--surface, #ffffff)',
                      border: '1px solid var(--line, #e1e9f5)',
                      fontSize: '11px',
                    }}
                  >
                    {lead.qualificationStatus}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #61718d)', marginTop: '2px' }}>
                {lead.companyName ? `${lead.companyName} • ` : ''}
                ID: <span style={{ fontFamily: 'monospace' }}>{lead.id.slice(0, 8)}…</span>
                {isLoadingFresh && <span style={{ marginLeft: '8px' }}>🔄 refreshing…</span>}
              </div>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close lead details"
            className="icon-button"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e1e9f5)',
              color: 'var(--text, #14213d)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {actionMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: actionMessage.startsWith('✓') ? '#ecfdf5' : '#fef2f2',
                color: actionMessage.startsWith('✓') ? '#047857' : '#b91c1c',
                border: `1px solid ${actionMessage.startsWith('✓') ? '#a7f3d0' : '#fecaca'}`,
              }}
            >
              {actionMessage}
            </div>
          )}
          {/* Section 1: Contact Details */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e1e9f5)',
              borderRadius: 'var(--radius-card, 12px)',
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--blue, #155eef)',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>📞</span> Contact Information
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '14px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Primary Phone
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <a
                    href={`tel:${cleanPhoneDigits}`}
                    style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}
                  >
                    {lead.phoneRaw || renderValue(null)}
                  </a>
                  {lead.phoneRaw && (
                    <button
                      type="button"
                      className="icon-button"
                      style={{ padding: '2px 6px', fontSize: '11px' }}
                      onClick={() => handleCopy(lead.phoneRaw, 'phone')}
                      title="Copy phone"
                    >
                      {copiedField === 'phone' ? '✓ Copied' : '📋'}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Normalized (E.164)
                </label>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                  {renderValue(lead.phoneNormalized)}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Email Address
                </label>
                <div>
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} style={{ color: 'var(--blue)' }}>
                      {lead.email}
                    </a>
                  ) : (
                    renderValue(null)
                  )}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Assigned Owner
                </label>
                <div>{renderValue(lead.ownerName)}</div>
              </div>
            </div>
          </div>

          {/* Section 2: Company & Source */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e1e9f5)',
              borderRadius: 'var(--radius-card, 12px)',
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--blue, #155eef)',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>🏢</span> Company & Acquisition
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '14px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Company Name
                </label>
                <div style={{ fontWeight: 600 }}>{renderValue(lead.companyName)}</div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Acquisition Source
                </label>
                <div>
                  <span
                    className="pill blue"
                    style={{ background: 'var(--surface-secondary, #f8faff)', display: 'inline-block' }}
                  >
                    {lead.source || 'Website'}
                  </span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Created Date
                </label>
                <div style={{ fontSize: '13px' }}>{formatDate(lead.createdAt)}</div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Last Updated
                </label>
                <div style={{ fontSize: '13px' }}>{formatDate(lead.updatedAt)}</div>
              </div>
            </div>
          </div>

          {/* Section 3: Deal Information & Pipeline */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e1e9f5)',
              borderRadius: 'var(--radius-card, 12px)',
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--blue, #155eef)',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>💼</span> Deal & Pipeline Status
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '14px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Estimated Deal Value
                </label>
                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text, #14213d)' }}>
                  ₹{((lead.dealValueMinorUnits || 0) / 100).toLocaleString('en-IN')}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Next Action
                </label>
                <div style={{ fontWeight: 600 }}>
                  {lead.nextAction === 'Call' && '📞 '}
                  {lead.nextAction === 'WhatsApp follow-up' && '💬 '}
                  {lead.nextAction === 'Meeting' && '👥 '}
                  {lead.nextAction === 'Send proposal' && '📄 '}
                  {lead.nextAction === 'Demo' && '🖥️ '}
                  {renderValue(lead.nextAction)}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Scheduled Follow-up
                </label>
                <div>{renderValue(lead.followUpAt)}</div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Pipeline Stage
                </label>
                <select
                  value={lead.stageName || 'New'}
                  onChange={(e) => handleStageChange(e.target.value)}
                  disabled={isUpdatingStage}
                  className="input-select"
                  style={{ fontSize: '13px', padding: '5px 8px', width: '100%' }}
                >
                  <option value="New">New</option>
                  <option value="Contacted">Contacted</option>
                  <option value="Qualified">Qualified</option>
                  <option value="Proposal">Proposal</option>
                  <option value="Won">Won</option>
                  <option value="Lost">Lost</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Workspace Tenant
                </label>
                <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                  {renderValue(lead.tenantId)}
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Consent & Compliance */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e1e9f5)',
              borderRadius: 'var(--radius-card, 12px)',
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--blue, #155eef)',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>🔒</span> Consent & Compliance
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '14px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  WhatsApp & Communication Consent
                </label>
                <div>
                  {lead.consentStatus === 'Consented' ? (
                    <span
                      style={{
                        color: 'var(--green-text, #027a48)',
                        background: 'var(--green-subtle, #ecfdf3)',
                        border: '1px solid var(--green-border, #abefc6)',
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-pill, 9999px)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      ✓ Consented
                    </span>
                  ) : lead.consentStatus === 'Opted Out' ? (
                    <span
                      style={{
                        color: 'var(--red-text, #b42318)',
                        background: 'var(--red-subtle, #fee4e2)',
                        border: '1px solid #fecdca',
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-pill, 9999px)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      ✕ Opted Out
                    </span>
                  ) : (
                    renderValue(null)
                  )}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600 }}>
                  Opted Out At
                </label>
                <div>{lead.optedOutAt ? formatDate(lead.optedOutAt) : renderValue(null)}</div>
              </div>
            </div>
          </div>

          {/* Section 5: Notes & Requirements */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e1e9f5)',
              borderRadius: 'var(--radius-card, 12px)',
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--blue, #155eef)',
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>📝</span> Notes & Inquiry Requirements
            </div>

            {lead.notes && lead.notes.trim() ? (
              <div
                style={{
                  background: 'var(--surface-secondary, #f8faff)',
                  border: '1px solid var(--line, #e1e9f5)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '12px 14px',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text, #14213d)',
                }}
              >
                {lead.notes}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                Not provided
              </div>
            )}
          </div>

          {/* Section 6: Activity History */}
          <div
            style={{
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--line, #e1e9f5)',
              borderRadius: 'var(--radius-card, 12px)',
              padding: '16px 20px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--blue, #155eef)',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⏱️</span> Activity & Timeline History
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {lead.activities?.length || 0} recorded
              </span>
            </div>

            {/* Add Note Form */}
            <form onSubmit={handleAddNote} style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              <input
                type="text"
                placeholder="Add a progress note or call summary…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="input-text"
                style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isAddingNote || !newNote.trim()}
                style={{ fontSize: '12px', padding: '6px 12px' }}
              >
                {isAddingNote ? 'Adding…' : '+ Add Note'}
              </button>
            </form>

            {lead.activities && lead.activities.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {lead.activities.map((act) => (
                  <div
                    key={act.id}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md, 8px)',
                      background: 'var(--surface-secondary, #f8faff)',
                      border: '1px solid var(--line, #e1e9f5)',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ fontSize: '14px' }}>
                      {act.activityType === 'lead_created' ? '✨' : '📌'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text, #14213d)' }}>
                        {act.summary}
                      </div>
                      <div style={{ color: 'var(--text-muted, #61718d)', fontSize: '11px', marginTop: '2px' }}>
                        By {act.actorName || 'System'} • {formatDate(act.occurredAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '13px', padding: '8px 0' }}>
                No activity history recorded for this lead yet.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--line, #e1e9f5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface-secondary, #f8faff)',
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn"
              style={{ fontSize: '12px', padding: '6px 12px' }}
              onClick={() => handleCopy(lead.id, 'id')}
            >
              {copiedField === 'id' ? '✓ ID Copied' : '📋 Copy Lead ID'}
            </button>
            {cleanPhoneDigits && (
              <a
                href={`https://wa.me/${cleanPhoneDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ fontSize: '12px', padding: '6px 12px', color: 'var(--green-text)' }}
              >
                💬 Open WhatsApp
              </a>
            )}
            <button
              type="button"
              className="btn btn-soft"
              style={{ fontSize: '12px', padding: '6px 12px', color: '#dc2626' }}
              onClick={handleDeleteLead}
            >
              🗑️ Delete Lead
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            style={{ minWidth: '90px' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LeadDetailModal;
