import React, { useState } from 'react';

export interface TopbarProps {
  onToggleSidebar: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onSearch: (query: string) => void;
  notificationCount?: number;
  onOpenNotifications: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  onToggleSidebar,
  isDarkMode,
  onToggleDarkMode,
  onSearch,
  notificationCount = 0,
  onOpenNotifications,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const currentPeriod = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(new Date());

  return (
    <header className="topbar">
      {/* Mobile Menu Hamburger */}
      <button
        type="button"
        className="icon-button mobile-menu-btn"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation drawer"
      >
        ☰
      </button>

      {/* Global Search */}
      <div className="search-bar">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Search leads, contacts, companies… (press Enter)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSearch(searchQuery.trim());
            }
          }}
          aria-label="Global Search"
        />
      </div>

      {/* Action Controls */}
      <div className="topbar-actions">
        {/* Date Filter */}
        <div
          className="icon-button hide-mobile"
          aria-label="Current reporting period"
          title="Current reporting period; date filtering is not available yet"
        >
          <span>▦</span>
          <span>{currentPeriod} · Current month</span>
        </div>

        {/* Notifications */}
        <button
          type="button"
          className="icon-button"
          onClick={onOpenNotifications}
          aria-label="Open recent activity"
        >
          <span>🔔</span>
          {notificationCount > 0 && (
            <span className="pill red" style={{ padding: '1px 5px', fontSize: '10px' }}>
              {notificationCount}
            </span>
          )}
        </button>

        {/* Dark Mode Toggle */}
        <button
          type="button"
          className="icon-button"
          onClick={onToggleDarkMode}
          aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} theme`}
          title={`Switch to ${isDarkMode ? 'light' : 'dark'} theme`}
        >
          {isDarkMode ? '☼ Light' : '☾ Dark'}
        </button>

        {/* User Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '6px' }}>
          <div className="avatar">RS</div>
          <div className="hide-mobile">
            <strong style={{ display: 'block', fontSize: '12px' }}>Rohan Singh</strong>
            <small style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Admin</small>
          </div>
        </div>
      </div>
    </header>
  );
};
