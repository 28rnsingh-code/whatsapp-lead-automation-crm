import { Lead, ApiResponse, ApiError } from '../types';

const API_BASE = ((import.meta as any).env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

function getActiveTenantId(): string {
  try {
    const raw = localStorage.getItem('auth_session');
    const session = raw ? JSON.parse(raw) : null;
    const tenantId = session?.tenant?.id;
    return typeof tenantId === 'string' ? tenantId : '';
  } catch {
    return '';
  }
}

/**
 * Returns the existing token only. Login must happen through the login screen;
 * API helpers never silently sign in with a shared demo credential.
 */
export async function getAuthToken(): Promise<string> {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    throw new Error('Authentication required. Please sign in to your workspace.');
  }
  if (!getActiveTenantId()) {
    throw new Error('Workspace session is missing. Please sign in again.');
  }
  return token;
}

/**
 * Authenticated API Request Wrapper with automatic 401 token refresh retry.
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('x-tenant-id', getActiveTenantId());
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && !isRetry) {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_session');
    return apiRequest<T>(endpoint, options, true);
  }

  const result = await response.json();
  if (!response.ok || !result.success) {
    const errorObj = result.error || {
      code: `HTTP_${response.status}`,
      message: result.message || `Request failed with status ${response.status}`,
    };
    const err: any = new Error(errorObj.message);
    err.code = errorObj.code;
    err.details = errorObj.details;
    err.status = response.status;
    throw err;
  }

  return result.data as T;
}

export interface FetchLeadsParams {
  q?: string;
  stage?: string;
  source?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateLeadPayload {
  name: string;
  phoneRaw: string;
  email?: string;
  companyName?: string;
  source?: string;
  stageId?: string;
  dealValue?: string;
  nextAction?: string;
  notes?: string;
}

/**
 * Fetches leads strictly from PostgreSQL via GET /api/leads
 */
export async function fetchLeadsApi(params?: FetchLeadsParams): Promise<Lead[]> {
  const query = new URLSearchParams();
  if (params?.q) query.set('q', params.q);
  if (params?.stage && params.stage !== 'All') query.set('stage', params.stage);
  if (params?.source && params.source !== 'All') query.set('source', params.source);
  if (params?.page) query.set('page', params.page.toString());
  if (params?.pageSize) query.set('pageSize', params.pageSize.toString());

  const qs = query.toString();
  const endpoint = `/leads${qs ? `?${qs}` : ''}`;
  return apiRequest<Lead[]>(endpoint, { method: 'GET' });
}

/**
 * Creates a lead in PostgreSQL via POST /api/leads
 */
export async function createLeadApi(payload: CreateLeadPayload): Promise<Lead> {
  return apiRequest<Lead>('/leads', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetches full details and activity history for a single lead by ID
 */
export async function fetchLeadByIdApi(id: string): Promise<Lead> {
  return apiRequest<Lead>(`/leads/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

// ==========================================
// Import & Export API Calls
// ==========================================

export interface ImportPreviewResponse {
  filename: string;
  format: string;
  totalRows: number;
  headers: string[];
  sampleRows: Record<string, string>[];
  allRows: Record<string, string>[];
  suggestedMapping: Record<string, string>;
}

export interface ImportValidateResponse {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  duplicates: Array<{ rowNumber: number; name: string; phoneNormalized: string }>;
  errors: Array<{ rowNumber: number; field: string; error: string; rowData: any }>;
  sampleValidRows: any[];
}

export interface ImportExecuteResponse {
  jobId: string;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface ImportJobRecord {
  id: string;
  filename: string;
  fileFormat: string;
  status: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  duplicateStrategy: string;
  createdAt: string;
  completedAt?: string;
}

export async function previewImportFileApi(payload: {
  content?: string;
  base64Data?: string;
  filename: string;
  format: string;
}): Promise<ImportPreviewResponse> {
  return apiRequest<ImportPreviewResponse>('/import/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function validateImportRowsApi(payload: {
  rows: any[];
  mapping: Record<string, string>;
}): Promise<ImportValidateResponse> {
  return apiRequest<ImportValidateResponse>('/import/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function executeImportJobApi(payload: {
  rows: any[];
  mapping: Record<string, string>;
  duplicateStrategy: string;
  filename: string;
  format: string;
}): Promise<ImportExecuteResponse> {
  return apiRequest<ImportExecuteResponse>('/import/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getImportHistoryApi(): Promise<ImportJobRecord[]> {
  return apiRequest<ImportJobRecord[]>('/import/history', {
    method: 'GET',
  });
}

export async function downloadLeadsExportApi(params: {
  format: 'csv' | 'xlsx';
  stage?: string;
  source?: string;
}): Promise<Blob> {
  const token = await getAuthToken();
  const query = new URLSearchParams();
  query.set('format', params.format);
  if (params.stage && params.stage !== 'All') query.set('stage', params.stage);
  if (params.source && params.source !== 'All') query.set('source', params.source);

  const res = await fetch(`${API_BASE}/export/leads?${query.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-tenant-id': getActiveTenantId(),
    },
  });

  if (!res.ok) {
    throw new Error(`Export failed with status ${res.status}`);
  }

  return res.blob();
}

// ==========================================
// Core CRM & Workflow API Calls
// ==========================================

export async function updateLeadApi(id: string, payload: any): Promise<Lead> {
  return apiRequest<Lead>(`/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteLeadApi(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`/leads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function addLeadActivityApi(id: string, summary: string, activityType: string = 'note_added'): Promise<any> {
  return apiRequest<any>(`/leads/${encodeURIComponent(id)}/activities`, {
    method: 'POST',
    body: JSON.stringify({ summary, activityType }),
  });
}

export async function fetchPipelineStagesApi(): Promise<any[]> {
  return apiRequest<any[]>('/pipeline/stages', { method: 'GET' });
}

export async function fetchTasksApi(): Promise<any[]> {
  return apiRequest<any[]>('/tasks', { method: 'GET' });
}

export async function createTaskApi(payload: {
  title: string;
  leadId?: string;
  leadName?: string;
  company?: string;
  taskType?: string;
  dueAt?: string;
  priority?: string;
}): Promise<any> {
  return apiRequest<any>('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTaskApi(id: string, payload: any): Promise<any> {
  return apiRequest<any>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteTaskApi(id: string): Promise<any> {
  return apiRequest<any>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchContactsApi(q?: string): Promise<any[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiRequest<any[]>(`/contacts${query}`, { method: 'GET' });
}

export async function createContactApi(payload: {
  name: string;
  phoneRaw: string;
  email?: string;
  jobTitle?: string;
  companyId?: string;
  companyName?: string;
  notes?: string;
}): Promise<any> {
  return apiRequest<any>('/contacts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteContactApi(id: string): Promise<any> {
  return apiRequest<any>(`/contacts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchCompaniesApi(): Promise<any[]> {
  return apiRequest<any[]>('/contacts/companies', { method: 'GET' });
}

export async function createCompanyApi(payload: {
  name: string;
  domain?: string;
  phone?: string;
  industry?: string;
  website?: string;
  address?: string;
}): Promise<any> {
  return apiRequest<any>('/contacts/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface DashboardStats {
  totalLeads: number;
  pipelineValue: number;
  currency: string;
  activeFollowups: number;
  overdueTasks: number;
  wonLeadsCount: number;
  conversionRate: number;
  stageBreakdown: Array<{ stage: string; color: string; count: number; totalValue: number }>;
  sourceBreakdown: Array<{ source: string; count: number }>;
}

export async function fetchDashboardStatsApi(): Promise<DashboardStats> {
  return apiRequest<DashboardStats>('/dashboard/stats', { method: 'GET' });
}

// ==========================================
// WhatsApp Provider & Messaging API Calls
// ==========================================

export interface WhatsAppConfigResponse {
  config: {
    provider: string;
    phoneNumberId?: string;
    businessAccountId?: string;
    accessTokenMasked?: string;
    appSecretMasked?: string;
    apiKeyMasked?: string;
    sourceNumber?: string;
    status: 'connected' | 'unconfigured' | 'error';
    lastTestedAt?: string;
    errorMessage?: string;
  };
  supportedProviders: Array<{ id: string; name: string }>;
  webhookUrl: string;
}

export async function fetchWhatsAppConfigApi(): Promise<WhatsAppConfigResponse> {
  return apiRequest<WhatsAppConfigResponse>('/whatsapp/config', { method: 'GET' });
}

export async function updateWhatsAppConfigApi(payload: any): Promise<any> {
  return apiRequest<any>('/whatsapp/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface WhatsAppMessageItem {
  id: string;
  tenantId: string;
  leadId?: string;
  senderPhone: string;
  recipientPhone: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string;
  status: string;
  createdAt: string;
  aiGenerated?: boolean;
}

export async function fetchWhatsAppMessagesApi(phone?: string, leadId?: string): Promise<WhatsAppMessageItem[]> {
  const query = new URLSearchParams();
  if (phone) query.set('phone', phone);
  if (leadId) query.set('leadId', leadId);
  const qs = query.toString();
  return apiRequest<WhatsAppMessageItem[]>(`/whatsapp/messages${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

export async function sendWhatsAppMessageApi(payload: {
  recipientPhone: string;
  body?: string;
  templateName?: string;
  templateParameters?: string[];
  leadId?: string;
}): Promise<WhatsAppMessageItem> {
  return apiRequest<WhatsAppMessageItem>('/whatsapp/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchWhatsAppTemplatesApi(): Promise<any[]> {
  return apiRequest<any[]>('/whatsapp/templates', { method: 'GET' });
}

// ==========================================
// Customer-Configurable AI Provider API Calls
// ==========================================

export interface AiConfigResponse {
  config: {
    provider: string;
    apiKeyMasked?: string;
    model: string;
    mode: 'disabled' | 'draft_only' | 'approval_before_send' | 'automatic_send';
    systemPrompt: string;
    businessContext: string;
    confidenceThreshold: number;
    maxOutputChars: number;
    enabled: boolean;
    status: 'active' | 'unconfigured' | 'error';
    lastTestedAt?: string;
    errorMessage?: string;
  };
  supportedProviders: Array<{ id: string; name: string; supportedModels: string[] }>;
}

export async function fetchAiConfigApi(): Promise<AiConfigResponse> {
  return apiRequest<AiConfigResponse>('/ai/config', { method: 'GET' });
}

export async function updateAiConfigApi(payload: any): Promise<any> {
  return apiRequest<any>('/ai/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface GenerateAiReplyResponse {
  replyText: string;
  confidence: number;
  tokensUsed?: number;
  model: string;
  mode: string;
  passesThreshold: boolean;
  requiresApproval: boolean;
}

export async function generateAiReplyApi(payload: {
  incomingMessage: string;
  leadName?: string;
  companyName?: string;
  conversationHistory?: any[];
}): Promise<GenerateAiReplyResponse> {
  return apiRequest<GenerateAiReplyResponse>('/ai/generate-reply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function approveAiReplyApi(payload: {
  recipientPhone: string;
  replyText: string;
  leadId?: string;
}): Promise<any> {
  return apiRequest<any>('/ai/approve-reply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ==========================================
// Reporting, Usage Metering & Billing Calls
// ==========================================

export interface ReportsAnalyticsResponse {
  winRate: number;
  avgDealSize: number;
  currency: string;
  funnel: Array<{ stage: string; count: number; pct: number; color: string }>;
  leaderboard: Array<{ owner: string; leadsOwned: number; dealsClosed: number; revenue: number }>;
  sources: Array<{ source: string; count: number; pct: number }>;
}

export async function fetchReportsAnalyticsApi(range: string = '30d'): Promise<ReportsAnalyticsResponse> {
  return apiRequest<ReportsAnalyticsResponse>(`/reports/analytics?range=${encodeURIComponent(range)}`, {
    method: 'GET',
  });
}

export interface TenantUsageResponse {
  periodKey: string;
  plan: {
    id: string;
    name: string;
    priceMonthlyInr: number;
    limits: {
      maxLeads: number;
      maxImportsPerMonth: number;
      maxMessagesPerMonth: number;
      maxAiTokens: number;
    };
  };
  usage: {
    leadsCount: number;
    maxLeads: number;
    leadsPct: number;
    messagesCount: number;
    maxMessages: number;
    messagesPct: number;
    importRowsCount: number;
    maxImports: number;
    aiTokensCount: number;
    maxAiTokens: number;
  };
}

export async function fetchTenantUsageApi(): Promise<TenantUsageResponse> {
  return apiRequest<TenantUsageResponse>('/reports/usage', { method: 'GET' });
}

export async function downloadReportsCsvApi(range: string = '30d'): Promise<Blob> {
  const token = await getAuthToken();
  const res = await fetch(`${API_BASE}/reports/export?range=${encodeURIComponent(range)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-tenant-id': getActiveTenantId(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download report: HTTP ${res.status}`);
  }

  return res.blob();
}

export async function fetchSubscriptionApi(): Promise<any> {
  return apiRequest<any>('/billing/subscription', { method: 'GET' });
}

export async function fetchBillingPlansApi(): Promise<any[]> {
  return apiRequest<any[]>('/billing/plans', { method: 'GET' });
}

export async function changePlanApi(planId: string): Promise<any> {
  return apiRequest<any>('/billing/change-plan', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}






export interface IntegrationStatusResponse {
  tenantSlug: string;
  webhook: {
    configured: boolean;
    secretMasked: string;
    endpoint: string;
    status: string;
  };
  whatsapp: {
    configured: boolean;
    provider: string;
    status: string;
  };
  ai: {
    configured: boolean;
    provider: string;
    status: string;
    mode: string;
  };
}

export async function fetchIntegrationStatusApi(): Promise<IntegrationStatusResponse> {
  return apiRequest<IntegrationStatusResponse>('/integrations/status', { method: 'GET' });
}

export async function rotateWebsiteWebhookApi(): Promise<{
  secret: string;
  tenantSlug: string;
  webhookUrl: string;
  secretDisplayedOnce: boolean;
  note: string;
}> {
  return apiRequest('/integrations/website-webhook/rotate', { method: 'POST', body: JSON.stringify({}) });
}

export interface WorkspaceListItem {
  id: string; name: string; slug: string; status: string;
  timezone: string; currency: string; locale: string; role?: string;
}
export async function fetchWorkspacesApi(): Promise<WorkspaceListItem[]> {
  return apiRequest<WorkspaceListItem[]>('/workspaces', { method: 'GET' });
}
export interface TeamMember {
  membershipId: string; userId: string; name: string; email: string;
  role: 'Admin' | 'Sales Manager' | 'Sales Executive' | 'Read-only';
  status: 'active' | 'invited' | 'suspended'; leadsAssigned: number;
}
export interface TeamMembersResponse { members: TeamMember[]; demoMode: boolean; }
export async function fetchTeamMembersApi(): Promise<TeamMembersResponse> {
  return apiRequest<TeamMembersResponse>('/team/members', { method: 'GET' });
}
export async function createTeamInvitationApi(payload: { email: string; displayName?: string; role: TeamMember['role'] }): Promise<{
  invitationId: string; membershipId: string; email: string; displayName: string; role: string;
  status: string; inviteUrl: string; expiresAt: string; emailSent: boolean; message: string;
}> {
  return apiRequest('/team/invitations', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateTeamMemberApi(membershipId: string, payload: { role?: TeamMember['role']; status?: 'active' | 'suspended' }): Promise<TeamMember> {
  return apiRequest<TeamMember>('/team/members/' + encodeURIComponent(membershipId), { method: 'PATCH', body: JSON.stringify(payload) });
}
export async function acceptTeamInvitationApi(payload: { token: string; password?: string }): Promise<{
  email: string; workspaceName: string; membershipId: string; passwordAlreadySet: boolean;
  loginRequired: boolean; message: string;
}> {
  return apiRequest('/team/invitations/accept', { method: 'POST', body: JSON.stringify(payload) });
}
export interface AuditEventItem {
  id: string; actor: string; action: string; entityType: string; entityId: string;
  occurredAt: string; requestId: string; metadata?: Record<string, unknown>;
}
export interface AuditEventsResponse {
  events: AuditEventItem[]; totalCount: number; page: number; pageSize: number; demoMode: boolean;
}
export async function fetchAuditEventsApi(page = 1, pageSize = 50): Promise<AuditEventsResponse> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiRequest<AuditEventsResponse>('/audit/events?' + query.toString(), { method: 'GET' });
}
export async function downloadAuditCsvApi(): Promise<Blob> {
  const token = await getAuthToken();
  const response = await fetch(API_BASE + '/audit/export', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, 'x-tenant-id': getActiveTenantId() },
  });
  if (!response.ok) throw new Error('Audit export failed with HTTP ' + response.status);
  return response.blob();
}
