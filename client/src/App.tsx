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
import { InvitationAcceptancePage } from './pages/InvitationAcceptancePage';

export const App: React.FC = () => {
  const [inviteToken, setInviteToken] = useState<string>(() => new URLSearchParams(window.location.search).get('invite') || '');
  const [currentPage, setCurrentPage] = useState<NavigationPage>(() =>
    localStorage.getItem('auth_token') && localStorage.getItem('auth_session') ? 'dashboard' : 'auth'
  );
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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
    // The CRM pages require a real signed-in user and a persisted workspace session.
    if ((!localStorage.getItem('auth_token') || !localStorage.getItem('auth_session')) && currentPage !== 'auth') {
      return <AuthPage onAuthenticated={() => setCurrentPage('dashboard')} />;
    }
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
        return <IntegrationsPage onNavigate={setCurrentPage} />;
      case 'importexport':
        return <ImportExportPage />;
      case 'team':
        return <TeamPage />;
      case 'settings':
        return <SettingsPage />;
      case 'audit':
        return <AuditPage />;
      case 'auth':
        return <AuthPage onAuthenticated={() => setCurrentPage('dashboard')} />;
      default:
        return <DashboardPage onNavigate={setCurrentPage} />;
    }
  };

  if (inviteToken) {
    return (
      <InvitationAcceptancePage token={inviteToken} onBackToLogin={() => {
        window.history.replaceState({}, document.title, window.location.pathname);
        setInviteToken('');
        setCurrentPage('auth');
      }} />
    );
  }

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
