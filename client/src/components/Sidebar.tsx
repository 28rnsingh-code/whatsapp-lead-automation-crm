import React from 'react';
import { NavigationPage } from '../types';

export interface SidebarProps {
  currentPage: NavigationPage;
  onNavigate: (page: NavigationPage) => void;
  isOpen: boolean;
  onClose: () => void;
  onOpenWorkspaceModal: () => void;
  onOpenPlans: () => void;
  currentWorkspaceName: string;
  isDemo: boolean;
  demoUsageText?: string;
}

interface NavItem {
  id: NavigationPage;
  label: string;
  icon: string;
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'onboarding', label: 'Getting Started', icon: '✦' },
  { id: 'leads', label: 'Lead Inbox', icon: '▤', badge: 24 },
  { id: 'pipeline', label: 'Sales Pipeline', icon: '▥' },
  { id: 'followups', label: 'Follow-ups', icon: '◷', badge: 12 },
  { id: 'contacts', label: 'Contacts & Companies', icon: '♙' },
  { id: 'reports', label: 'Reports & Analytics', icon: '▧' },
  { id: 'whatsapp', label: 'WhatsApp Inbox', icon: '◉' },
  { id: 'integrations', label: 'Integrations', icon: '⌘' },
  { id: 'importexport', label: 'Import / Export', icon: '⇅' },
  { id: 'team', label: 'Team & Permissions', icon: '♧' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
  { id: 'audit', label: 'Audit Log', icon: '▣' },
  { id: 'auth', label: 'Sign Out', icon: '↪' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  isOpen,
  onClose,
  onOpenWorkspaceModal,
  onOpenPlans,
  currentWorkspaceName,
  isDemo,
  demoUsageText = '0 of 5 demo actions used',
}) => {
  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`} id="sidebar">
      {/* Brand Header */}
      <div className="brand">
        <div className="brandmark">O</div>
        <div className="brand-text">
          <strong>One.Click Autonix</strong>
          <small>CRM + WhatsApp Lead SaaS</small>
        </div>
      </div>

      {/* Workspace Switcher */}
      <button
        type="button"
        className="workspace-button"
        disabled={isDemo}
        onClick={onOpenWorkspaceModal}
        aria-label="Switch active workspace"
      >
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>{currentWorkspaceName}</span>
          <small style={{ display: 'block', color: 'var(--sidebar-muted)', fontSize: '11px' }}>
            Workspace ▾
          </small>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--sidebar-muted)' }}>▦</span>
      </button>

      {/* Nav List */}
      <nav className="nav-group" aria-label="Main Navigation">
        {NAV_ITEMS.filter((item) => !isDemo || ['dashboard', 'leads', 'pipeline', 'followups', 'contacts', 'reports', 'whatsapp', 'auth'].includes(item.id)).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-button ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => {
              onNavigate(item.id);
              onClose();
            }}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span className="nav-badge">{item.badge}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Footer & User Card */}
      <div className="sidebar-footer">
        {isDemo ? (
          <div className="upgrade-card" role="status">
            <strong>Public Demo</strong>
            <p>{demoUsageText}</p>
            <p style={{ fontSize: '11px' }}>WhatsApp and email delivery are simulated. Real integrations require your own authorised provider credentials.</p>
          </div>
        ) : (
        <div className="upgrade-card">
          <strong>✦ Upgrade Plan</strong>
          <p>More leads, team members, and higher WhatsApp API message limits.</p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', fontSize: '11px', padding: '6px 8px', justifyContent: 'center' }}
            onClick={onOpenPlans}
          >
            Explore Plans
          </button>
        </div>
        )}

        <div className="user-profile-card">
          <div className="avatar">RS</div>
          <div>
            <strong style={{ display: 'block', fontSize: '12px', color: '#ffffff' }}>{isDemo ? 'Demo Visitor' : 'Rohan Singh'}</strong>
            <small style={{ color: 'var(--sidebar-muted)', fontSize: '11px' }}>{isDemo ? 'Restricted Demo Access' : 'Workspace User'}</small>
          </div>
        </div>
      </div>
    </aside>
  );
};
