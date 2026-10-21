export * from '../../../shared/types';

export type NavigationPage =
  | 'dashboard'
  | 'onboarding'
  | 'leads'
  | 'pipeline'
  | 'followups'
  | 'contacts'
  | 'reports'
  | 'whatsapp'
  | 'integrations'
  | 'importexport'
  | 'team'
  | 'settings'
  | 'audit'
  | 'auth';

export interface ToastMessage {
  id: string;
  text: string;
  type?: 'info' | 'success' | 'warning' | 'error';
}
