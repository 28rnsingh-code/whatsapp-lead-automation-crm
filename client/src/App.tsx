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
import { fetchAuthSessionApi } from './services/api';

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<NavigationPage>('dashboard');
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([
    { id: '1', text: 'Welcome back, Rohan! 4 new leads arrived via Website & WhatsApp.', type: 'info' },
  ]);

  useEffect(() => {
    let cancelled = false;

    const handleUnauthorized = () => {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('active_tenant_id');
      setAuthState('unauthenticated');
      setCurrentPage('auth');
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    if (!localStorage.getItem('auth_token')) {
      setAuthState('unauthenticated');
      setCurrentPage('auth');
    } else {
      fetchAuthSessionApi()
        .then(() => {
          if (!cancelled) setAuthState('authenticated');
        })
        .catch(() => {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('active_tenant_id');
          if (!cancelled) {
            setAuthState('unauthenticated');
            setCurrentPage('auth');
          }
        });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const handleLogin = () => {
    setAuthState('authenticated');
    setCurrentPage('dashboard');
  };

  const handleNavigate = (page: NavigationPage) => {
    if (page === 'auth') {
      localStorage.removeItem('auth_token');
      setAuthState('unauthenticated');
      setCurrentPage('auth');
      return;
    }
    setCurrentPage(page);
  };

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
        return <DashboardPage onNavigate={handleNavigate} />;
      case 'onboarding':
        return <OnboardingPage onNavigate={handleNavigate} />;
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
        return null;
      default:
        return <DashboardPage onNavigate={handleNavigate} />;
    }
  };

  if (authState === 'checking') {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', color: 'var(--text-muted, #667085)' }}
      >
        Checking your workspace session…
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return <AuthPage onLogin={handleLogin} />;
  }

  return (
    <AppShell
      currentPage={currentPage}
      onNavigate={handleNavigate}
      isDarkMode={isDarkMode}
      onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
    >
      {renderCurrentPage()}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </AppShell>
  );
};

export default App;
