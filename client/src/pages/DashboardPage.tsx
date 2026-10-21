import React, { useEffect, useState } from 'react';
import { KpiCard } from '../components/KpiCard';
import { StatusPill } from '../components/StatusPill';
import { NavigationPage } from '../types';
import { fetchDashboardStatsApi, fetchTasksApi, DashboardStats } from '../services/api';

export interface DashboardPageProps {
  onNavigate: (page: NavigationPage) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, tasksData] = await Promise.all([
        fetchDashboardStatsApi(),
        fetchTasksApi(),
      ]);
      setStats(statsData);
      setTasks(tasksData.slice(0, 5));
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const formatCurrency = (val: number) => {
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(1)}L`;
    }
    return `₹${val.toLocaleString()}`;
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1>Executive CRM Dashboard</h1>
          <div className="page-header-sub">
            Real-time pipeline metrics, lead conversions, and follow-up activities across your tenant workspace.
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-soft" onClick={loadData} disabled={loading}>
            🔄 {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="btn btn-soft" onClick={() => onNavigate('reports')}>
            View Analytics
          </button>
          <button className="btn btn-primary" onClick={() => onNavigate('leads')}>
            + New Lead
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', marginBottom: '20px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* 6 Top KPIs */}
      <div className="kpi-grid">
        <KpiCard
          label="Total Leads"
          value={stats ? stats.totalLeads.toString() : '...'}
          delta="Direct Database Count"
          deltaType="positive"
          icon="👥"
        />
        <KpiCard
          label="Pipeline Value"
          value={stats ? formatCurrency(stats.pipelineValue) : '...'}
          delta="Active Opportunities"
          deltaType="positive"
          icon="💼"
        />
        <KpiCard
          label="Deals Won"
          value={stats ? stats.wonLeadsCount.toString() : '...'}
          delta={stats ? `${stats.conversionRate}% conversion rate` : 'Calculating'}
          deltaType="positive"
          icon="🏆"
        />
        <KpiCard
          label="Active Follow-ups"
          value={stats ? stats.activeFollowups.toString() : '...'}
          delta="Pending tasks"
          deltaType="positive"
          icon="⏰"
        />
        <KpiCard
          label="Overdue Follow-ups"
          value={stats ? stats.overdueTasks.toString() : '...'}
          delta={stats && stats.overdueTasks > 0 ? 'Requires immediate action' : 'All up to date'}
          deltaType={stats && stats.overdueTasks > 0 ? 'negative' : 'positive'}
          icon="⚠️"
        />
        <KpiCard
          label="Conversion Rate"
          value={stats ? `${stats.conversionRate}%` : '...'}
          delta="Won / Total leads"
          deltaType="positive"
          icon="⚡"
        />
      </div>

      {/* Dashboard Multi-column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '20px', marginBottom: '20px' }}>
        {/* Pipeline Breakdown */}
        <div className="card">
          <div className="card-header">
            <h2>Sales Pipeline Distribution</h2>
            <button className="btn btn-soft" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => onNavigate('pipeline')}>
              Open Kanban →
            </button>
          </div>
          {stats && stats.stageBreakdown.length > 0 ? (
            <div style={{ display: 'grid', gap: '12px' }}>
              {stats.stageBreakdown.map((s) => {
                const maxCount = Math.max(...stats.stageBreakdown.map(b => b.count), 1);
                const pct = Math.round((s.count / maxCount) * 100);
                return (
                  <div key={s.stage} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 80px', gap: '10px', alignItems: 'center', fontSize: '13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: s.color }} />
                      {s.stage}
                    </div>
                    <div style={{ height: '8px', borderRadius: '99px', background: 'var(--surface-secondary)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: s.color, borderRadius: '99px', transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ textAlign: 'right', fontWeight: 700 }}>
                      {s.count} ({formatCurrency(s.totalValue)})
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              No pipeline stages or leads recorded yet.
            </div>
          )}
        </div>

        {/* Lead Sources Breakdown */}
        <div className="card">
          <div className="card-header">
            <h2>Inbound Lead Sources</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tenant Aggregate</span>
          </div>
          {stats && stats.sourceBreakdown.length > 0 ? (
            <div style={{ display: 'grid', gap: '14px' }}>
              {stats.sourceBreakdown.map((src) => {
                const totalSrc = stats.sourceBreakdown.reduce((sum, s) => sum + s.count, 0) || 1;
                const percent = Math.round((src.count / totalSrc) * 100);
                return (
                  <div key={src.source}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
                      <strong>{src.source}</strong>
                      <span>{src.count} leads ({percent}%)</span>
                    </div>
                    <div style={{ height: '7px', borderRadius: '99px', background: 'var(--surface-secondary)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${percent}%`, backgroundColor: '#3b82f6', borderRadius: '99px', transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              No inbound leads logged yet.
            </div>
          )}
        </div>
      </div>

      {/* Priority Follow-ups Quick Table */}
      <div className="card">
        <div className="card-header">
          <h2>High Priority Follow-ups</h2>
          <button className="btn btn-soft" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => onNavigate('followups')}>
            View All Follow-ups →
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Lead / Task</th>
                <th>Company</th>
                <th>Task Type</th>
                <th>Priority</th>
                <th>Due Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <strong>{task.title}</strong>
                      {task.leadName && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{task.leadName}</div>}
                    </td>
                    <td>{task.company || '-'}</td>
                    <td>{task.taskType}</td>
                    <td>
                      <StatusPill
                        label={task.priority}
                        variant={task.priority === 'High' ? 'red' : task.priority === 'Medium' ? 'amber' : 'blue'}
                      />
                    </td>
                    <td>
                      <span style={{
                        color: task.category === 'Overdue' ? '#dc2626' : task.category === 'Today' ? '#d97706' : 'inherit',
                        fontWeight: task.category === 'Overdue' || task.category === 'Today' ? 600 : 400
                      }}>
                        {new Date(task.dueAt).toLocaleDateString()} {new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td>
                      <StatusPill
                        label={task.completed ? 'Completed' : task.category || 'Pending'}
                        variant={task.completed ? 'green' : task.category === 'Overdue' ? 'red' : 'blue'}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                    No follow-ups scheduled. Create one in Follow-ups or Leads.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
