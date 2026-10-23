import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Modal } from './Modal';
import { NavigationPage } from '../types';
import { fetchWorkspacesApi, getDefaultTenantIdFromToken, WorkspaceSummary } from '../services/api';

export interface AppShellProps {
  currentPage: NavigationPage;
  onNavigate: (page: NavigationPage) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentPage,
  onNavigate,
  isDarkMode,
  onToggleDarkMode,
  children,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    () => localStorage.getItem('active_tenant_id'),
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');

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
          // Force all page queries to re-run with the verified replacement workspace.
          window.location.reload();
        }
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(error instanceof Error ? error.message : 'Unable to load available workspaces.');
        }
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
      }
    };

    void loadWorkspaces();
    return () => { cancelled = true; };
  }, []);

  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId);

  const handleWorkspaceSelect = (workspace: WorkspaceSummary) => {
    if (workspace.id === currentWorkspaceId) {
      setWorkspaceModalOpen(false);
      return;
    }
    localStorage.setItem('active_tenant_id', workspace.id);
    setCurrentWorkspaceId(workspace.id);
    setWorkspaceModalOpen(false);
    // A full reload ensures every mounted page issues its requests with the new tenant.
    window.location.reload();
  };

  return (
    <div className="app-container">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenWorkspaceModal={() => setWorkspaceModalOpen(true)}
        currentWorkspaceName={currentWorkspace?.name || (workspaceLoading ? 'Loading workspace…' : 'Workspace unavailable')}
      />

      <div className="main-wrapper">
        <Topbar
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          isDarkMode={isDarkMode}
          onToggleDarkMode={onToggleDarkMode}
          onSearch={(query) => {
            if (query.trim()) onNavigate('leads');
          }}
          onOpenNotifications={() => window.dispatchEvent(new Event('crm:open-notifications'))}
        />
        <main className="content-container">{children}</main>
      </div>

      <Modal
        isOpen={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        title="Switch Workspace"
      >
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
    </div>
  );
};
