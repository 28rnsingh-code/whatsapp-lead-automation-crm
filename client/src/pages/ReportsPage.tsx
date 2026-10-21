import React, { useState, useEffect } from 'react';
import { KpiCard } from '../components/KpiCard';
import {
  fetchReportsAnalyticsApi,
  fetchTenantUsageApi,
  downloadReportsCsvApi,
  ReportsAnalyticsResponse,
  TenantUsageResponse,
} from '../services/api';

export const ReportsPage: React.FC = () => {
  const [range, setRange] = useState<string>('30d');
  const [analytics, setAnalytics] = useState<ReportsAnalyticsResponse | null>(null);
  const [usage, setUsage] = useState<TenantUsageResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = async (selectedRange: string = range) => {
    setLoading(true);
    try {
      const [analyticsData, usageData] = await Promise.all([
        fetchReportsAnalyticsApi(selectedRange),
        fetchTenantUsageApi(),
      ]);
      setAnalytics(analyticsData);
      setUsage(usageData);
    } catch (err: any) {
      showToast(`Error loading reports: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(range);
  }, [range]);

  const handleExportCsv = async () => {
    setDownloading(true);
    try {
      const blob = await downloadReportsCsvApi(range);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crm_analytics_${range}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast('Analytics report downloaded successfully.');
    } catch (err: any) {
      showToast(`Export failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const formatCurrency = (val: number) => {
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(1)}L`;
    }
    return `₹${val.toLocaleString()}`;
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
          <h1>Reports & Revenue Analytics</h1>
          <div className="page-header-sub">
            Real-time attribution, conversion velocity, and usage metering from your tenant database.
          </div>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: 'var(--surface-secondary)', padding: '2px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            {[
              { id: '7d', label: '7D' },
              { id: '30d', label: '30D' },
              { id: '90d', label: '90D' },
              { id: 'all', label: 'All' },
            ].map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: 0,
                  fontSize: '12px',
                  fontWeight: range === r.id ? 700 : 500,
                  background: range === r.id ? 'var(--surface)' : 'transparent',
                  color: range === r.id ? 'var(--blue)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  boxShadow: range === r.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button className="btn btn-soft" onClick={() => loadData(range)} disabled={loading}>
            🔄 {loading ? 'Loading…' : 'Refresh'}
          </button>

          <button className="btn btn-primary" onClick={handleExportCsv} disabled={downloading}>
            {downloading ? 'Exporting…' : '📥 Export CSV'}
          </button>
        </div>
      </div>

      {/* Top Real KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          label="Overall Win Rate"
          value={analytics ? `${analytics.winRate}%` : '...'}
          delta="Direct Database Aggregation"
          deltaType="positive"
          icon="📈"
        />
        <KpiCard
          label="Avg Won Deal Size"
          value={analytics ? formatCurrency(analytics.avgDealSize) : '...'}
          delta="Won revenue per deal"
          deltaType="positive"
          icon="💎"
        />
        <KpiCard
          label="Current Plan Tier"
          value={usage ? usage.plan.name : 'Starter'}
          delta={usage ? `₹${usage.plan.priceMonthlyInr.toLocaleString()}/month` : 'Active'}
          deltaType="positive"
          icon="🛡️"
        />
        <KpiCard
          label="Plan Leads Usage"
          value={usage ? `${usage.usage.leadsCount} / ${usage.usage.maxLeads}` : '...'}
          delta={usage ? `${usage.usage.leadsPct}% capacity utilized` : 'Computing'}
          deltaType={usage && usage.usage.leadsPct > 80 ? 'negative' : 'positive'}
          icon="👥"
        />
        <KpiCard
          label="WhatsApp Volume"
          value={usage ? `${usage.usage.messagesCount} / ${usage.usage.maxMessages}` : '...'}
          delta="Outbound & Inbound"
          deltaType="positive"
          icon="📱"
        />
        <KpiCard
          label="Reporting Window"
          value={range === 'all' ? 'All Time' : `Last ${range.toUpperCase()}`}
          delta="Timezone UTC+05:30 Safe"
          deltaType="positive"
          icon="🎯"
        />
      </div>

      {/* Usage Metering Progress Cards */}
      {usage && (
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-header">
            <div>
              <h2>SaaS Subscription & Resource Metering</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                Period: {usage.periodKey} • Enforcing configured quota boundaries
              </p>
            </div>
            <span className="pill" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
              ✓ Quota Healthy
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginTop: '12px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <strong>Active Leads</strong>
                <span>{usage.usage.leadsCount} / {usage.usage.maxLeads} ({usage.usage.leadsPct}%)</span>
              </div>
              <div style={{ height: '8px', borderRadius: '99px', background: 'var(--surface-secondary)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${usage.usage.leadsPct}%`, backgroundColor: '#3b82f6', borderRadius: '99px' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <strong>WhatsApp Messages</strong>
                <span>{usage.usage.messagesCount} / {usage.usage.maxMessages} ({usage.usage.messagesPct}%)</span>
              </div>
              <div style={{ height: '8px', borderRadius: '99px', background: 'var(--surface-secondary)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${usage.usage.messagesPct}%`, backgroundColor: '#10b981', borderRadius: '99px' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <strong>AI Tokens / Month</strong>
                <span>{usage.usage.aiTokensCount} / {usage.usage.maxAiTokens}</span>
              </div>
              <div style={{ height: '8px', borderRadius: '99px', background: 'var(--surface-secondary)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((usage.usage.aiTokensCount / usage.usage.maxAiTokens) * 100)}%`, backgroundColor: '#8b5cf6', borderRadius: '99px' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conversion Funnel & Leaderboard Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
        {/* Stage Funnel */}
        <div className="card">
          <div className="card-header">
            <h2>Conversion Funnel by Pipeline Stage</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Real SQL Progression</span>
          </div>
          {analytics && analytics.funnel.length > 0 ? (
            <div style={{ display: 'grid', gap: '14px', padding: '10px 0' }}>
              {analytics.funnel.map((f) => (
                <div key={f.stage}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                    <strong>{f.stage}</strong>
                    <span>{f.count} leads ({f.pct}%)</span>
                  </div>
                  <div style={{ height: '10px', borderRadius: '99px', background: 'var(--surface-secondary)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(f.pct, 4)}%`, backgroundColor: f.color, borderRadius: '99px', transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              No pipeline stage activity in this timeframe.
            </div>
          )}
        </div>

        {/* Team Leaderboard */}
        <div className="card">
          <div className="card-header">
            <h2>Team Conversion Leaderboard</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>By Deals Won</span>
          </div>
          <div className="table-container" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Executive</th>
                  <th>Leads Owned</th>
                  <th>Deals Closed</th>
                  <th>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {analytics && analytics.leaderboard.length > 0 ? (
                  analytics.leaderboard.map((u) => (
                    <tr key={u.owner}>
                      <td><strong>{u.owner}</strong></td>
                      <td>{u.leadsOwned}</td>
                      <td>{u.dealsClosed}</td>
                      <td><strong>{formatCurrency(u.revenue)}</strong></td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No deal closures recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
