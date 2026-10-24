import React, { useState, useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { ToastContainer } from './components/Toast';
import { NavigationPage, ToastMessage } from './types';

// Page Views
import { DashboardPage } from './pages/DashboardPage';
import { LeadsPage } from './pages/LeadsPage';
import { PipelinePage } from './pages/PipelinePage';
import { FollowupsPage } from './pages/FollowupsPage';
import { ContactsPage } from './pages/ContactsPage';
import { ReportsPage } from './pages/ReportsPage';
import { WhatsAppPage } from './pages/WhatsAppPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { ImportExportPage } from './pages/ImportExportPage';
import { TeamPage } from './pages/TeamPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditPage } from './pages/AuditPage';
import { AuthPage } from './pages/AuthPage';
import { OnboardingPage } from './pages/OnboardingPage';

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<NavigationPage>('dashboard');
  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([
    { id: '1', text: 'Welcome back, Rohan! 4 new leads arrived via Website & WhatsApp.', type: 'info' },
  ]);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setIsAuthenticated(false);
      setAuthChecking(false);
      return () => { cancelled = true; };
    }
    const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
    const apiBase = /^https?:\/\//i.test(configuredApiBase) && !configuredApiBase.endsWith('/api')
      ? `${configuredApiBase}/api`
      : configuredApiBase;
    let tenantId = '';
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      tenantId = JSON.parse(atob(payload)).defaultTenantId || '';
    } catch { tenantId = ''; }
    fetch(`${apiBase}/auth/session`, {
      headers: { Authorization: `Bearer ${token}`, ...(tenantId ? { 'x-tenant-id': tenantId } : {}) },
    })
      .then(response => { if (!response.ok) throw new Error('Session expired'); return response.json(); })
      .then(result => { if (!result.success) throw new Error('Session invalid'); if (!cancelled) setIsAuthenticated(true); })
      .catch(() => { localStorage.removeItem('auth_token'); if (!cancelled) setIsAuthenticated(false); })
      .finally(() => { if (!cancelled) setAuthChecking(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const addToast = (text: string, type: ToastMessage['type'] = 'info') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage onNavigate={setCurrentPage} />;
      case 'onboarding':
        return <OnboardingPage onNavigate={setCurrentPage} />;
      case 'leads':
        return <LeadsPage />;
      case 'pipeline':
        return <PipelinePage />;
      case 'followups':
        return <FollowupsPage />;
      case 'contacts':
        return <ContactsPage />;
      case 'reports':
        return <ReportsPage />;
      case 'whatsapp':
        return <WhatsAppPage />;
      case 'integrations':
        return <IntegrationsPage />;
      case 'importexport':
        return <ImportExportPage />;
      case 'team':
        return <TeamPage />;
      case 'settings':
        return <SettingsPage />;
      case 'audit':
        return <AuditPage />;
      case 'auth':
        return <AuthPage />;
      default:
        return <DashboardPage onNavigate={setCurrentPage} />;
    }
  };

  if (authChecking) return <div role="status" style={{ padding: '48px', textAlign: 'center' }}>Checking your workspace session…</div>;
  if (!isAuthenticated) return <AuthPage onLoginSuccess={() => { setIsAuthenticated(true); setCurrentPage('dashboard'); }} />;

  return (
    <AppShell
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      isDarkMode={isDarkMode}
      onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
    >
      {renderCurrentPage()}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </AppShell>
  );
};

export default App;
