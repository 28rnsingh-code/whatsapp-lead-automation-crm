import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Modal } from './Modal';
import { NavigationPage } from '../types';
import { fetchWorkspacesApi, WorkspaceListItem } from '../services/api';

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
  const [currentWorkspace, setCurrentWorkspace] = useState(() => {
    try { return JSON.parse(localStorage.getItem('auth_session') || '{}').tenant?.name || 'Workspace'; }
    catch { return 'Workspace'; }
  });
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [workspaceError, setWorkspaceError] = useState('');
  useEffect(() => {
    let active = true;
    fetchWorkspacesApi()
      .then((items) => { if (active) { setWorkspaces(items); setWorkspaceError(''); } })
      .catch((err: any) => { if (active) setWorkspaceError(err.message || 'Unable to load workspaces.'); });
    return () => { active = false; };
  }, []);

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenWorkspaceModal={() => setWorkspaceModalOpen(true)}
        currentWorkspaceName={currentWorkspace}
      />

      {/* Main App Content Viewport */}
      <div className="main-wrapper">
        <Topbar
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          isDarkMode={isDarkMode}
          onToggleDarkMode={onToggleDarkMode}
          onSearch={(query) => {
            if (query.trim()) {
              onNavigate('leads');
            }
          }}
          onOpenNotifications={() => onNavigate('followups')}
        />

        <main className="content-container">
          {children}
        </main>
      </div>

      {/* Switch Workspace Modal Dialog */}
      <Modal
        isOpen={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        title="Switch Workspace"
      >
        <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          Select the active workspace to switch your team, pipeline, and WhatsApp lead context.
        </p>
        <div style={{ display: 'grid', gap: '10px' }}>
          {workspaceError && <p role="alert" style={{ color: 'var(--red-text)' }}>{workspaceError}</p>}
          {workspaces.length === 0 && !workspaceError && <p style={{ color: 'var(--text-muted)' }}>No additional workspaces are available for this account.</p>}
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              onClick={() => {
                try {
                  const raw = localStorage.getItem('auth_session');
                  if (raw) {
                    const session = JSON.parse(raw);
                    localStorage.setItem('auth_session', JSON.stringify({ ...session, tenant: ws, role: ws.role || session.role }));
                  }
                } catch {
                  setWorkspaceError('Could not switch workspace. Sign in again.');
                  return;
                }
                setCurrentWorkspace(ws.name);
                setWorkspaceModalOpen(false);
                window.location.reload();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: currentWorkspace === ws.name ? 'var(--blue-subtle)' : 'var(--surface)',
                borderColor: currentWorkspace === ws.name ? 'var(--blue)' : 'var(--line)',
              }}
            >
              <div>
                <strong style={{ display: 'block', fontSize: '14px' }}>{ws.name}</strong>
                <small style={{ color: 'var(--text-muted)' }}>{ws.currency || 'INR'} • Role: {ws.role || 'Workspace member'}</small>
              </div>
              {currentWorkspace === ws.name && (
                <span style={{ color: 'var(--blue)', fontWeight: 700 }}>✓ Active</span>
              )}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            onClick={() => setWorkspaceModalOpen(false)}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
};
