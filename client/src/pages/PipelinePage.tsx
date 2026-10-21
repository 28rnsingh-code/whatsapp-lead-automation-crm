import React, { useState, useEffect } from 'react';
import { fetchPipelineStagesApi, fetchLeadsApi, updateLeadApi } from '../services/api';
import { Lead } from '../types';
import { LeadDetailModal } from '../components/LeadDetailModal';

export const PipelinePage: React.FC = () => {
  const [stages, setStages] = useState<any[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string>('All');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadPipeline = async () => {
    setLoading(true);
    try {
      const [stagesData, leadsData] = await Promise.all([
        fetchPipelineStagesApi(),
        fetchLeadsApi({ pageSize: 100 }),
      ]);
      setStages(stagesData);
      setLeads(leadsData);
    } catch (err: any) {
      showToast(`Failed to load pipeline: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPipeline();
  }, []);

  const advanceStage = async (lead: Lead, direction: 'next' | 'prev') => {
    if (stages.length === 0) return;
    const currentIndex = stages.findIndex(
      (s) => s.id === lead.stageId || s.name.toLowerCase() === (lead.stageName || '').toLowerCase()
    );

    let targetIndex = -1;
    if (direction === 'next' && currentIndex < stages.length - 1) {
      targetIndex = currentIndex + 1;
    } else if (direction === 'prev' && currentIndex > 0) {
      targetIndex = currentIndex - 1;
    }

    if (targetIndex === -1) return;
    const targetStage = stages[targetIndex];

    setUpdatingId(lead.id);
    try {
      const updated = await updateLeadApi(lead.id, {
        stageId: targetStage.id,
      });

      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, stageId: targetStage.id, stageName: targetStage.name, stageColor: targetStage.colorToken } : l))
      );
      showToast(`Moved ${lead.name} to "${targetStage.name}"`);
    } catch (err: any) {
      showToast(`Error updating stage: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredLeads = selectedSource === 'All'
    ? leads
    : leads.filter((l) => l.source === selectedSource);

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
          <h1>Sales Pipeline</h1>
          <div className="page-header-sub">
            Track deal progression, stage velocity, and won/lost outcomes loaded dynamically from tenant database configuration.
          </div>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            className="input-select"
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            style={{ width: '160px', padding: '6px 10px', fontSize: '13px' }}
          >
            <option value="All">All Sources</option>
            <option value="Website">Website</option>
            <option value="WhatsApp">WhatsApp</option>
            <option value="Referral">Referral</option>
            <option value="Cold Inbound">Cold Inbound</option>
            <option value="Bulk Import">Bulk Import</option>
          </select>
          <button className="btn btn-soft" onClick={loadPipeline} disabled={loading}>
            🔄 {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Kanban Grid */}
      <div className="kanban-grid" style={{ overflowX: 'auto', paddingBottom: '16px' }}>
        {stages.map((stage, idx) => {
          const stageLeads = filteredLeads.filter(
            (l) => l.stageId === stage.id || (l.stageName && l.stageName.toLowerCase() === stage.name.toLowerCase())
          );
          const stageTotal = stageLeads.reduce(
            (sum, l) => sum + (l.dealValueMinorUnits ? l.dealValueMinorUnits / 100 : 0),
            0
          );

          return (
            <div key={stage.id || stage.name} className="kanban-column" style={{ minWidth: '260px' }}>
              <div className="kanban-column-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: stage.colorToken || stage.color || '#155eef',
                    }}
                  />
                  <strong style={{ fontSize: '13px' }}>{stage.name}</strong>
                  <span className="pill" style={{ padding: '1px 6px', fontSize: '11px', fontWeight: 600 }}>
                    {stageLeads.length}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  ₹{(stageTotal / 1000).toFixed(0)}k
                </div>
              </div>

              {/* Deal Cards */}
              <div style={{ display: 'grid', gap: '10px' }}>
                {stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="deal-card"
                    style={{
                      opacity: updatingId === lead.id ? 0.6 : 1,
                      transition: 'opacity 0.2s ease',
                      borderLeft: `3px solid ${stage.colorToken || '#155eef'}`,
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelectedLead(lead)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <strong style={{ display: 'block', fontSize: '13px' }}>{lead.name}</strong>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{lead.source}</span>
                    </div>
                    <small style={{ display: 'block', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      {lead.companyName || lead.phoneRaw}
                    </small>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--blue)' }}>
                        ₹{(lead.dealValueMinorUnits ? lead.dealValueMinorUnits / 100 : 0).toLocaleString('en-IN')}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        👤 {lead.ownerName || 'Rohan'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--line)', fontSize: '11px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{lead.nextAction || 'Follow up'}</span>
                      <div style={{ display: 'flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                        {idx > 0 && (
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ padding: '2px 6px', fontSize: '10px' }}
                            onClick={() => advanceStage(lead, 'prev')}
                            disabled={updatingId === lead.id}
                            title="Move to previous stage"
                          >
                            ←
                          </button>
                        )}
                        {idx < stages.length - 1 && (
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ padding: '2px 6px', fontSize: '10px' }}
                            onClick={() => advanceStage(lead, 'next')}
                            disabled={updatingId === lead.id}
                            title="Move to next stage"
                          >
                            Next →
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {stageLeads.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                    No leads in {stage.name}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lead Detail & Activity History Modal */}
      {selectedLead && (
        <LeadDetailModal
          isOpen={!!selectedLead}
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onLeadUpdated={(updated) => {
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
            setSelectedLead(updated);
            showToast(`Updated lead "${updated.name}"`);
          }}
          onLeadDeleted={(deletedId) => {
            setLeads((prev) => prev.filter((l) => l.id !== deletedId));
            setSelectedLead(null);
            showToast('Lead deleted successfully.');
          }}
        />
      )}
    </div>
  );
};
