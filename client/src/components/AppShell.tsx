import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Modal } from './Modal';
import { NavigationPage } from '../types';

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
  const [currentWorkspace, setCurrentWorkspace] = useState('Bring My Bite');

  const workspaces = [
    { id: '1', name: 'Bring My Bite', plan: 'Enterprise SaaS', role: 'Admin' },
    { id: '2', name: 'Automics Labs', plan: 'Growth Plan', role: 'Member' },
  ];

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
          onOpenNotifications={() => alert('3 new lead alerts today.')}
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
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              onClick={() => {
                setCurrentWorkspace(ws.name);
                setWorkspaceModalOpen(false);
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
                <small style={{ color: 'var(--text-muted)' }}>{ws.plan} • Role: {ws.role}</small>
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
