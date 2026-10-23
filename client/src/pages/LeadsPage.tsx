import React, { useState, useEffect, useCallback } from 'react';
import { StatusPill } from '../components/StatusPill';
import { Modal } from '../components/Modal';
import { LeadDetailModal } from '../components/LeadDetailModal';
import { Lead } from '../types';
import { fetchLeadsApi, createLeadApi } from '../services/api';

export interface LeadsPageProps { initialSearchQuery?: string; }

export const LeadsPage: React.FC<LeadsPageProps> = ({ initialSearchQuery = '' }) => {
  const [search, setSearch] = useState(initialSearchQuery);
  const [stageFilter, setStageFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Leads State & Network Flags
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form Submission & Validation State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Form Fields
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    source: 'Website' as const,
    dealValue: '100000',
    nextAction: 'Call' as const,
    notes: '',
  });

  // Fetch leads from PostgreSQL API
  const loadLeads = useCallback(async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      const data = await fetchLeadsApi();
      setLeads(data);
    } catch (err: any) {
      console.error('[LeadsPage] Failed to fetch leads:', err);
      setApiError(err.message || 'Unable to connect to PostgreSQL lead service.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Client-side filtering across current workspace leads
  const filteredLeads = leads.filter((l) => {
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      l.name.toLowerCase().includes(q) ||
      (l.phoneRaw && l.phoneRaw.includes(q)) ||
      (l.email && l.email.toLowerCase().includes(q)) ||
      (l.companyName && l.companyName.toLowerCase().includes(q));
    const matchesStage = stageFilter === 'All' || l.stageName === stageFilter;
    const matchesSource = sourceFilter === 'All' || l.source === sourceFilter;
    return matchesSearch && matchesStage && matchesSource;
  });

  // Form Submit Handler -> POST /api/leads
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Client-side quick check
    const errors: Record<string, string[]> = {};
    if (!formData.name.trim()) errors.name = ['Name is required.'];
    if (!formData.phone.trim()) errors.phone = ['Phone number is required.'];

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Please fill in all required fields.');
      return;
    }

    setIsSubmitting(true);
    try {
      const createdLead = await createLeadApi({
        name: formData.name.trim(),
        phoneRaw: formData.phone.trim(),
        email: formData.email.trim() || undefined,
        companyName: formData.company.trim() || undefined,
        source: formData.source,
        dealValue: formData.dealValue,
        nextAction: formData.nextAction,
        notes: formData.notes.trim() || undefined,
      });

      // Update state with lead persisted in PostgreSQL
      setLeads((prev) => [createdLead, ...prev.filter((l) => l.id !== createdLead.id)]);
      setIsCreateModalOpen(false);

      // Reset form
      setFormData({
        name: '',
        phone: '',
        email: '',
        company: '',
        source: 'Website',
        dealValue: '100000',
        nextAction: 'Call',
        notes: '',
      });

      // Show persistent confirmation
      setSuccessMessage(`✓ Lead "${createdLead.name}" was successfully saved to PostgreSQL database!`);
      setTimeout(() => {
        setSuccessMessage((current) => (current?.includes(createdLead.name) ? null : current));
      }, 5000);
    } catch (err: any) {
      console.error('[LeadsPage] Error creating lead:', err);
      if (err.status === 409) {
        setFormError(err.message || 'A lead with this phone number already exists in your workspace.');
      } else if (err.status === 400 && err.details) {
        setFormError(err.message || 'Validation error. Please verify the submitted fields.');
        setFieldErrors(err.details);
      } else {
        setFormError(err.message || 'Failed to persist lead to database.');
      }
    } finally {
      setIsSubmitting(false);
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

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Lead Inbox</h1>
          <div className="page-header-sub">
            Capture, qualify, deduplicate, and route leads with PostgreSQL persistence and multi-channel attribution.
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn"
            onClick={() => {
              if (leads.length === 0) {
                setApiError('No leads available to export.');
                return;
              }
              const headers = ['ID', 'Name', 'Phone', 'Email', 'Company', 'Source', 'Stage', 'Deal Value (INR)'];
              const rows = leads.map((l) => [
                l.id,
                `"${l.name.replace(/"/g, '""')}"`,
                l.phoneRaw,
                l.email || '',
                `"${(l.companyName || '').replace(/"/g, '""')}"`,
                l.source,
                l.stageName || 'New',
                (l.dealValueMinorUnits / 100).toString(),
              ]);
              const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
              const encodedUri = encodeURI(csvContent);
              const link = document.createElement('a');
              link.setAttribute('href', encodedUri);
              link.setAttribute('download', `leads_export_${new Date().toISOString().slice(0, 10)}.csv`);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              setSuccessMessage(`✓ Exported ${leads.length} leads as CSV.`);
            }}
          >
            ⇅ Export CSV
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setFormError(null);
              setFieldErrors({});
              setIsCreateModalOpen(true);
            }}
          >
            + Create Lead
          </button>
        </div>
      </div>

      {/* Global Success Notification */}
      {successMessage && (
        <div
          style={{
            background: 'var(--green-subtle, #ecfdf3)',
            color: 'var(--green-text, #027a48)',
            border: '1px solid var(--green-border, #abefc6)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md, 8px)',
            marginBottom: '16px',
            fontSize: '13px',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* API Error Notification */}
      {apiError && (
        <div
          style={{
            background: 'var(--red-subtle, #fef3f2)',
            color: 'var(--red-text, #b42318)',
            border: '1px solid #fecdca',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md, 8px)',
            marginBottom: '16px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>⚠️ {apiError}</span>
          <button
            type="button"
            onClick={loadLeads}
            className="btn"
            style={{ padding: '4px 10px', fontSize: '12px' }}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="toolbar card" style={{ padding: '12px 16px' }}>
        <input
          type="search"
          placeholder="Filter by name, company, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="form-control"
          style={{ minWidth: '260px', flex: 1 }}
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="select-control"
        >
          <option value="All">All Stages</option>
          <option value="New">New</option>
          <option value="Contacted">Contacted</option>
          <option value="Qualified">Qualified</option>
          <option value="Proposal">Proposal</option>
          <option value="Won">Won</option>
          <option value="Lost">Lost</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="select-control"
        >
          <option value="All">All Sources</option>
          <option value="Website">Website</option>
          <option value="WhatsApp">WhatsApp</option>
          <option value="Google Ads">Google Ads</option>
          <option value="Referral">Referral</option>
          <option value="Direct">Direct</option>
        </select>
        <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--text-muted)' }}>
          {isLoading ? (
            <span>Loading PostgreSQL leads…</span>
          ) : (
            <span>Showing <strong>{filteredLeads.length}</strong> of {leads.length} leads</span>
          )}
        </div>
      </div>

      {/* Leads Table Container */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Lead / Contact</th>
                <th>Company</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Deal Value</th>
                <th>Next Action</th>
                <th>Consent</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'inline-block', marginBottom: '8px' }}>🔄</div>
                    <div>Loading workspace leads from PostgreSQL (localhost:5434)…</div>
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '48px 16px' }}>
                    <div style={{ fontSize: '24px', marginBottom: '8px' }}>📭</div>
                    <strong style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>No leads found</strong>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {search || stageFilter !== 'All' || sourceFilter !== 'All'
                        ? 'Try clearing your filters or search term to see other leads.'
                        : 'Capture your first lead using the "+ Create Lead" button above.'}
                    </span>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <div>
                        <strong>{lead.name}</strong>
                        {lead.email && (
                          <small style={{ display: 'block', color: 'var(--text-muted)' }}>{lead.email}</small>
                        )}
                      </div>
                    </td>
                    <td>{lead.companyName || '—'}</td>
                    <td>{lead.phoneRaw}</td>
                    <td>
                      <span className="pill blue" style={{ background: 'var(--surface-secondary)' }}>
                        {lead.source}
                      </span>
                    </td>
                    <td>
                      <StatusPill
                        label={lead.stageName || 'New'}
                        variant={getStageVariant(lead.stageName)}
                      />
                    </td>
                    <td>{lead.ownerName || 'Unassigned'}</td>
                    <td>
                      <strong>₹{(lead.dealValueMinorUnits / 100).toLocaleString('en-IN')}</strong>
                    </td>
                    <td>
                      <span style={{ fontSize: '12px' }}>
                        {lead.nextAction === 'Call' && '📞 '}
                        {lead.nextAction === 'WhatsApp follow-up' && '💬 '}
                        {lead.nextAction === 'Meeting' && '👥 '}
                        {lead.nextAction === 'Send proposal' && '📄 '}
                        {lead.nextAction === 'Demo' && '🖥️ '}
                        {lead.nextAction}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '11px',
                          color: lead.consentStatus === 'Consented' ? 'var(--green-text)' : 'var(--text-muted)',
                        }}
                      >
                        {lead.consentStatus === 'Consented' ? '✓ Consented' : 'Unknown'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="icon-button"
                        style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600 }}
                        onClick={() => {
                          setSelectedLead(lead);
                          setIsDetailModalOpen(true);
                        }}
                        aria-label={`View details for ${lead.name}`}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Lead Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          if (!isSubmitting) setIsCreateModalOpen(false);
        }}
        title="Create New Lead"
      >
        <form onSubmit={handleCreateLead}>
          {formError && (
            <div
              style={{
                background: 'var(--red-subtle, #fef3f2)',
                color: 'var(--red-text, #b42318)',
                border: '1px solid #fecdca',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md, 8px)',
                marginBottom: '14px',
                fontSize: '13px',
              }}
            >
              ⚠️ {formError}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Full Name *
              </label>
              <input
                type="text"
                required
                className="form-control"
                style={{
                  width: '100%',
                  borderColor: fieldErrors.name ? 'var(--red-text, #b42318)' : undefined,
                }}
                placeholder="e.g. Ramesh Patel"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: [] });
                }}
                disabled={isSubmitting}
              />
              {fieldErrors.name && (
                <div style={{ color: 'var(--red-text, #b42318)', fontSize: '11px', marginTop: '2px' }}>
                  {fieldErrors.name.join(' ')}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Phone (India / E.164) *
              </label>
              <input
                type="tel"
                required
                className="form-control"
                style={{
                  width: '100%',
                  borderColor: fieldErrors.phone || fieldErrors.phoneRaw ? 'var(--red-text, #b42318)' : undefined,
                }}
                placeholder="+91 98765 00000"
                value={formData.phone}
                onChange={(e) => {
                  setFormData({ ...formData, phone: e.target.value });
                  if (fieldErrors.phone || fieldErrors.phoneRaw) {
                    const copy = { ...fieldErrors };
                    delete copy.phone;
                    delete copy.phoneRaw;
                    setFieldErrors(copy);
                  }
                }}
                disabled={isSubmitting}
              />
              {(fieldErrors.phone || fieldErrors.phoneRaw) && (
                <div style={{ color: 'var(--red-text, #b42318)', fontSize: '11px', marginTop: '2px' }}>
                  {(fieldErrors.phone || fieldErrors.phoneRaw || []).join(' ')}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Email Address
              </label>
              <input
                type="email"
                className="form-control"
                style={{ width: '100%' }}
                placeholder="ramesh@company.in"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Company Name
              </label>
              <input
                type="text"
                className="form-control"
                style={{ width: '100%' }}
                placeholder="e.g. Patel Logistics"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Lead Source
              </label>
              <select
                className="select-control"
                style={{ width: '100%' }}
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value as any })}
                disabled={isSubmitting}
              >
                <option value="Website">Website</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Google Ads">Google Ads</option>
                <option value="Referral">Referral</option>
                <option value="Direct">Direct</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Estimated Deal Value (INR)
              </label>
              <input
                type="number"
                className="form-control"
                style={{ width: '100%' }}
                placeholder="100000"
                value={formData.dealValue}
                onChange={(e) => setFormData({ ...formData, dealValue: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Next Action
              </label>
              <select
                className="select-control"
                style={{ width: '100%' }}
                value={formData.nextAction}
                onChange={(e) => setFormData({ ...formData, nextAction: e.target.value as any })}
                disabled={isSubmitting}
              >
                <option value="Call">Call</option>
                <option value="WhatsApp follow-up">WhatsApp Follow-up</option>
                <option value="Meeting">Meeting</option>
                <option value="Send proposal">Send Proposal</option>
                <option value="Demo">Demo</option>
              </select>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600 }}>
                Notes / Requirements
              </label>
              <textarea
                className="form-control"
                style={{ width: '100%', minHeight: '70px' }}
                placeholder="Specific customer requirements or inquiry notes…"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving to Database…' : 'Save Lead'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Lead Details Modal */}
      <LeadDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedLead(null);
        }}
        lead={selectedLead}
        onLeadUpdated={(updated) => {
          setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
          setSelectedLead(updated);
        }}
        onLeadDeleted={(deletedId) => {
          setLeads((prev) => prev.filter((l) => l.id !== deletedId));
          setSuccessMessage('✓ Lead was successfully removed.');
        }}
      />
    </div>
  );
};

export default LeadsPage;
