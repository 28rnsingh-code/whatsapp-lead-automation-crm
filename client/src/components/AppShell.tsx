import React, { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Modal } from './Modal';
import { NavigationPage } from '../types';
import {
  changePlanApi,
  fetchBillingPlansApi,
  fetchLeadsApi,
  fetchSubscriptionApi,
  fetchTasksApi,
  fetchWorkspacesApi,
  getDefaultTenantIdFromToken,
  WorkspaceSummary,
} from '../services/api';

export interface AppShellProps {
  currentPage: NavigationPage;
  onNavigate: (page: NavigationPage) => void;
  onGlobalSearch: (query: string) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  children: React.ReactNode;
  isDemo: boolean;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPage,
  onNavigate,
  onGlobalSearch,
  isDarkMode,
  onToggleDarkMode,
  children,
  isDemo,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    () => localStorage.getItem('active_tenant_id'),
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const [openTasks, setOpenTasks] = useState<any[]>([]);

  const [plansOpen, setPlansOpen] = useState(false);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState('');
  const [plans, setPlans] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [changingPlanId, setChangingPlanId] = useState('');
  const [planNotice, setPlanNotice] = useState('');
  const [demoUsageText, setDemoUsageText] = useState('Loading demo usage…');

  useEffect(() => {
    if (!isDemo) return;
    let cancelled = false;
    const loadDemoUsage = async () => {
      try {
        const configuredBase = import.meta.env.VITE_API_BASE_URL || '/api';
        const apiBase = configuredBase.endsWith('/') ? configuredBase.slice(0, -1) : configuredBase;
        const fullApiBase = (apiBase.startsWith('http://') || apiBase.startsWith('https://')) && !apiBase.endsWith('/api')
          ? apiBase + '/api'
          : apiBase;
        const response = await fetch(fullApiBase + '/demo/usage', {
          headers: {
            Authorization: 'Bearer ' + (localStorage.getItem('auth_token') || ''),
            'x-tenant-id': localStorage.getItem('active_tenant_id') || '',
          },
        });
        const payload = await response.json();
        if (!cancelled && response.ok && payload.success) {
          setDemoUsageText(String(payload.data.used) + ' of ' + String(payload.data.limit) + ' demo actions used · ' + String(payload.data.remaining) + ' remaining');
        } else if (!cancelled) setDemoUsageText('Demo usage is currently unavailable');
      } catch {
        if (!cancelled) setDemoUsageText('Demo usage is currently unavailable');
      }
    };
    void loadDemoUsage();
    return () => { cancelled = true; };
  }, [isDemo]);

  useEffect(() => {
    let cancelled = false;
    const loadWorkspaces = async () => {
      setWorkspaceLoading(true);
      setWorkspaceError('');
      try {
        const available = await fetchWorkspacesApi();
        if (cancelled) return;

        const savedId = localStorage.getItem('active_tenant_id');
        const token = localStorage.getItem('auth_token');
        const defaultId = token ? getDefaultTenantIdFromToken(token) : null;
        const selectedId =
          (savedId && available.some((workspace) => workspace.id === savedId) ? savedId : null) ||
          (defaultId && available.some((workspace) => workspace.id === defaultId) ? defaultId : null) ||
          available[0]?.id ||
          null;

        setWorkspaces(available);
        setCurrentWorkspaceId(selectedId);
        if (selectedId) localStorage.setItem('active_tenant_id', selectedId);
        else localStorage.removeItem('active_tenant_id');

        if (savedId && !available.some((workspace) => workspace.id === savedId) && selectedId) {
          window.location.reload();
        }
      } catch (error) {
        if (!cancelled) setWorkspaceError(error instanceof Error ? error.message : 'Unable to load available workspaces.');
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
      }
    };
    void loadWorkspaces();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return;
    let cancelled = false;
    const loadNotifications = async () => {
      setNotificationLoading(true);
      setNotificationError('');
      try {
        const [leads, tasks] = await Promise.all([
          fetchLeadsApi({ page: 1, pageSize: 5 }),
          fetchTasksApi(),
        ]);
        if (cancelled) return;

        const sortedLeads = [...leads].sort((a, b) =>
          new Date(b.createdAt || b.updatedAt || 0).getTime() -
          new Date(a.createdAt || a.updatedAt || 0).getTime()
        ).slice(0, 5);
        const pendingTasks = tasks
          .filter((task) => !['Completed', 'Cancelled'].includes(String(task.status)))
          .sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime())
          .slice(0, 5);
        setRecentLeads(sortedLeads);
        setOpenTasks(pendingTasks);
      } catch (error) {
        if (!cancelled) setNotificationError(error instanceof Error ? error.message : 'Unable to load recent activity.');
      } finally {
        if (!cancelled) setNotificationLoading(false);
      }
    };
    void loadNotifications();
    return () => { cancelled = true; };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!plansOpen) return;
    let cancelled = false;
    const loadPlans = async () => {
      setPlansLoading(true);
      setPlansError('');
      setPlanNotice('');
      try {
        const [availablePlans, currentSubscription] = await Promise.all([
          fetchBillingPlansApi(),
          fetchSubscriptionApi(),
        ]);
        if (cancelled) return;
        setPlans(availablePlans);
        setSubscription(currentSubscription);
      } catch (error) {
        if (!cancelled) setPlansError(error instanceof Error ? error.message : 'Unable to load plan information.');
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    };
    void loadPlans();
    return () => { cancelled = true; };
  }, [plansOpen]);

  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  const notificationCount = useMemo(() => recentLeads.length + openTasks.length, [recentLeads.length, openTasks.length]);

  const handleWorkspaceSelect = (workspace: WorkspaceSummary) => {
    if (workspace.id === currentWorkspaceId) {
      setWorkspaceModalOpen(false);
      return;
    }
    localStorage.setItem('active_tenant_id', workspace.id);
    setCurrentWorkspaceId(workspace.id);
    setWorkspaceModalOpen(false);
    window.location.reload();
  };

  const handleSelectPlan = async (planId: string) => {
    if (planId === subscription?.planId || changingPlanId) return;
    setChangingPlanId(planId);
    setPlansError('');
    setPlanNotice('');
    try {
      const updated = await changePlanApi(planId);
      setSubscription(updated);
      setPlanNotice('Plan entitlement updated. This environment does not charge a card or complete a live payment checkout.');
    } catch (error) {
      setPlansError(error instanceof Error ? error.message : 'Unable to update the plan.');
    } finally {
      setChangingPlanId('');
    }
  };

  return (
    <div className="app-container">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenWorkspaceModal={() => setWorkspaceModalOpen(true)}
        onOpenPlans={() => setPlansOpen(true)}
        currentWorkspaceName={currentWorkspace?.name || (workspaceLoading ? 'Loading workspace…' : 'Workspace unavailable')}
        isDemo={isDemo}
        demoUsageText={demoUsageText}
      />

      <div className="main-wrapper">
        <Topbar
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          isDarkMode={isDarkMode}
          onToggleDarkMode={onToggleDarkMode}
          onSearch={onGlobalSearch}
          notificationCount={notificationCount}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />
        <main className="content-container">{children}</main>
      </div>

      <Modal isOpen={workspaceModalOpen} onClose={() => setWorkspaceModalOpen(false)} title="Switch Workspace">
        <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Select a workspace that your account is authorised to access.
        </p>
        {workspaceLoading && <p role="status" style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading your workspaces…</p>}
        {workspaceError && <p role="alert" style={{ color: 'var(--red-text, #b42318)', fontSize: '13px' }}>{workspaceError}</p>}
        {!workspaceLoading && !workspaceError && workspaces.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No active workspaces are linked to this account.</p>
        )}
        <div style={{ display: 'grid', gap: '10px' }}>
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => handleWorkspaceSelect(workspace)}
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                textAlign: 'left',
                border: '1px solid var(--line)',
                borderColor: currentWorkspaceId === workspace.id ? 'var(--blue)' : 'var(--line)',
                background: currentWorkspaceId === workspace.id ? 'var(--blue-subtle)' : 'var(--surface)',
              }}
              disabled={workspaceLoading}
            >
              <span>
                <strong style={{ display: 'block', fontSize: '14px' }}>{workspace.name}</strong>
                <small style={{ color: 'var(--text-muted)' }}>{workspace.role} · {workspace.slug}</small>
              </span>
              {currentWorkspaceId === workspace.id && <span style={{ color: 'var(--blue)', fontWeight: 700 }}>✓ Active</span>}
            </button>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => setWorkspaceModalOpen(false)}>Close</button>
        </div>
      </Modal>

      <Modal isOpen={notificationsOpen} onClose={() => setNotificationsOpen(false)} title="Recent CRM Activity">
        {notificationLoading && <p role="status" style={{ color: 'var(--text-muted)' }}>Loading activity from your workspace…</p>}
        {notificationError && <p role="alert" style={{ color: 'var(--red-text, #b42318)' }}>{notificationError}</p>}
        {!notificationLoading && !notificationError && recentLeads.length === 0 && openTasks.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>No leads or pending follow-ups were found in this workspace.</p>
        )}
        {!notificationLoading && !notificationError && (
          <div style={{ display: 'grid', gap: '16px' }}>
            <section>
              <h3 style={{ margin: '0 0 8px', fontSize: '13px' }}>Recent leads</h3>
              {recentLeads.length === 0
                ? <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No leads found.</p>
                : recentLeads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    className="btn"
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', marginBottom: '6px', textAlign: 'left' }}
                    onClick={() => { setNotificationsOpen(false); onNavigate('leads'); }}
                  >
                    <span><strong>{lead.name}</strong><small style={{ display: 'block', color: 'var(--text-muted)' }}>{lead.companyName || lead.phoneRaw || 'Lead'}</small></span>
                    <small style={{ color: 'var(--text-muted)' }}>{lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : 'Recent'}</small>
                  </button>
                ))}
            </section>
            <section>
              <h3 style={{ margin: '0 0 8px', fontSize: '13px' }}>Pending follow-ups</h3>
              {openTasks.length === 0
                ? <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No pending follow-ups.</p>
                : openTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="btn"
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', marginBottom: '6px', textAlign: 'left' }}
                    onClick={() => { setNotificationsOpen(false); onNavigate('followups'); }}
                  >
                    <span><strong>{task.title}</strong><small style={{ display: 'block', color: 'var(--text-muted)' }}>{task.status || 'Pending'}</small></span>
                    <small style={{ color: 'var(--text-muted)' }}>{task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'No due date'}</small>
                  </button>
                ))}
            </section>
          </div>
        )}
      </Modal>

      <Modal isOpen={plansOpen} onClose={() => setPlansOpen(false)} title="Choose a Plan">
        <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: '13px' }}>
          Review the configured subscription tiers for this workspace.
        </p>
        {plansLoading && <p role="status" style={{ color: 'var(--text-muted)' }}>Loading plan and subscription information…</p>}
        {plansError && <p role="alert" style={{ color: 'var(--red-text, #b42318)' }}>{plansError}</p>}
        {planNotice && <p role="status" style={{ color: 'var(--green-text, #027a48)', fontSize: '13px' }}>{planNotice}</p>}
        {!plansLoading && !plansError && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
            {plans.map((plan) => {
              const isCurrent = plan.id === subscription?.planId;
              const limits = plan.limits || {};
              return (
                <div key={plan.id} style={{ border: '1px solid var(--line)', borderColor: isCurrent ? 'var(--blue)' : 'var(--line)', borderRadius: 'var(--radius-md)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <strong>{plan.name}</strong>
                  <div><strong style={{ fontSize: '22px' }}>₹{Number(plan.priceMonthlyInr || 0).toLocaleString('en-IN')}</strong><small style={{ color: 'var(--text-muted)' }}>/month</small></div>
                  <small style={{ color: 'var(--text-muted)' }}>{Number(limits.maxLeads || 0).toLocaleString('en-IN')} leads · {Number(limits.maxMessagesPerMonth || 0).toLocaleString('en-IN')} WhatsApp messages/month</small>
                  {Array.isArray(plan.features) && <ul style={{ paddingLeft: '18px', margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>{plan.features.slice(0, 4).map((feature: string) => <li key={feature}>{feature}</li>)}</ul>}
                  <button
                    type="button"
                    className={isCurrent ? 'btn btn-soft' : 'btn btn-primary'}
                    disabled={isCurrent || Boolean(changingPlanId) || plansLoading}
                    onClick={() => void handleSelectPlan(String(plan.id))}
                    style={{ marginTop: 'auto' }}
                  >
                    {changingPlanId === plan.id ? 'Updating…' : isCurrent ? 'Current plan' : 'Select plan'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: '16px', padding: '12px', border: '1px dashed var(--line)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '12px' }}>
          <strong>Sandbox billing mode:</strong> plan selection updates CRM subscription entitlements only. It does not charge a card or perform a live checkout; payment-provider integration must be configured separately.
        </div>
      </Modal>
    </div>
  );
};
