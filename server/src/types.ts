// ==========================================
// OneClick Automics CRM — Server Contracts
// ==========================================

export type UUID = string;

export interface Tenant {
  id: UUID;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'trial';
  timezone: string;
  currency: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

export type RoleName = 'Admin' | 'Sales Manager' | 'Sales Executive' | 'Read-only';

export interface User {
  id: UUID;
  email: string;
  displayName: string;
  status: 'active' | 'invited' | 'suspended';
  avatarUrl?: string;
  createdAt: string;
}

export interface Membership {
  id: UUID;
  tenantId: UUID;
  userId: UUID;
  role: RoleName;
  status: 'active' | 'invited' | 'suspended';
  invitedAt?: string;
  acceptedAt?: string;
}

export interface SessionContext {
  user: User;
  tenant: Tenant;
  role: RoleName;
  permissions: string[];
}

export type LeadSource = 'Website' | 'WhatsApp' | 'Google Ads' | 'Referral' | 'Direct' | 'Other';

export interface PipelineStage {
  id: UUID;
  tenantId: UUID;
  name: string;
  sortOrder: number;
  colorToken: string;
  isWon: boolean;
  isLost: boolean;
  active: boolean;
}

export type QualificationStatus = 'Not Qualified' | 'In Review' | 'Qualified';
export type ConsentStatus = 'Unknown' | 'Consented' | 'Opted Out';
export type NextActionType = 'Call' | 'Email' | 'WhatsApp follow-up' | 'Meeting' | 'Send proposal' | 'Demo' | 'Other' | 'None';

export interface Lead {
  id: UUID;
  tenantId: UUID;
  name: string;
  phoneRaw: string;
  phoneNormalized: string;
  email?: string;
  companyName?: string;
  source: LeadSource;
  stageId: UUID;
  stageName?: string;
  stageColor?: string;
  qualificationStatus: QualificationStatus;
  ownerUserId?: UUID;
  ownerName?: string;
  dealValueMinorUnits: number;
  currency: string;
  nextAction: NextActionType;
  followUpAt?: string;
  consentStatus: ConsentStatus;
  consentSource?: string;
  consentRecordedAt?: string;
  optedOutAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  activities?: ActivityRecord[];
}

export interface ActivityRecord {
  id: UUID;
  activityType: string;
  summary: string;
  occurredAt: string;
  actorName?: string;
}

export type TaskStatus = 'Pending' | 'Completed' | 'Overdue' | 'Cancelled';
export type TaskPriority = 'Low' | 'Medium' | 'High';

export interface Task {
  id: UUID;
  tenantId: UUID;
  leadId?: UUID;
  leadName?: string;
  title: string;
  taskType: NextActionType;
  ownerUserId: UUID;
  ownerName?: string;
  dueAt: string;
  timezone: string;
  priority: TaskPriority;
  status: TaskStatus;
  completedAt?: string;
  createdAt: string;
}

export interface AuditEvent {
  id: UUID;
  tenantId: UUID;
  actorUserId: UUID;
  actorName: string;
  action: string;
  entityType: string;
  entityId: UUID;
  occurredAt: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    totalCount?: number;
    totalPages?: number;
    requestId?: string;
    serverTimestamp?: string;
  };
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[] | string>;
    requestId: string;
  };
}
