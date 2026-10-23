export type PlanTier = 'starter' | 'growth' | 'enterprise';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'suspended';
export type BillingProviderType = 'razorpay' | 'stripe' | 'mock';

export interface PlanLimits {
  maxMembers: number;
  maxLeads: number;
  maxImportsPerMonth: number;
  maxMessagesPerMonth: number;
  maxAiTokens: number;
}

export interface PlanDefinition {
  id: PlanTier;
  name: string;
  priceMonthlyInr: number;
  limits: PlanLimits;
  features: string[];
}

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    priceMonthlyInr: 2999,
    limits: {
      maxMembers: 2,
      maxLeads: 1000,
      maxImportsPerMonth: 10,
      maxMessagesPerMonth: 500,
      maxAiTokens: 50000,
    },
    features: ['Up to 2 team members', '1,000 Active Leads', '10 Excel/CSV Imports/mo', '500 WhatsApp Messages/mo', 'Basic AI Auto-Reply'],
  },
  growth: {
    id: 'growth',
    name: 'Growth Plan',
    priceMonthlyInr: 7999,
    limits: {
      maxMembers: 5,
      maxLeads: 10000,
      maxImportsPerMonth: 100,
      maxMessagesPerMonth: 5000,
      maxAiTokens: 500000,
    },
    features: ['Up to 5 team members', '10,000 Active Leads', '100 Imports/mo', '5,000 WhatsApp Messages/mo', 'Advanced Multi-model AI', 'Custom Pipelines'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise Plan',
    priceMonthlyInr: 19999,
    limits: {
      maxMembers: 10,
      maxLeads: 100000,
      maxImportsPerMonth: 1000,
      maxMessagesPerMonth: 50000,
      maxAiTokens: 5000000,
    },
    features: ['Up to 10 team members', '100,000 Active Leads', '50,000 WhatsApp Messages/mo', 'Dedicated WhatsApp Number', 'Custom Integrations', 'SLA Support'],
  },
};

export interface TenantSubscriptionInfo {
  tenantId: string;
  planId: PlanTier;
  planName: string;
  status: SubscriptionStatus;
  billingProvider: BillingProviderType;
  limits: PlanLimits;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt?: string;
}

export interface TenantUsageCounters {
  periodKey: string;
  leadsCount: number;
  messagesCount: number;
  importRowsCount: number;
  aiRequestsCount: number;
  aiTokensCount: number;
}

export interface BillingWebhookEvent {
  provider: BillingProviderType;
  eventId: string;
  eventType: 'subscription.created' | 'subscription.renewed' | 'subscription.cancelled' | 'payment.failed';
  tenantId: string;
  planId: PlanTier;
  status: SubscriptionStatus;
  timestamp: Date;
}

export interface BillingProviderAdapter {
  readonly id: BillingProviderType;
  readonly name: string;

  verifyWebhookSignature(payload: string | Buffer, signature: string, secret: string): boolean;
  parseWebhookEvent(body: any): BillingWebhookEvent | null;
}
