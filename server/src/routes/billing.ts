import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';
import { DEFAULT_TENANT_ID } from '../db/seed';
import { PLAN_DEFINITIONS, PlanTier, TenantSubscriptionInfo } from '../services/billing/types';
import { getBillingAdapter } from '../services/billing/mockBillingAdapter';

const router = Router();

const TENANT_UUID_MAP: Record<string, string> = {
  tenant_bring_my_bite: DEFAULT_TENANT_ID,
  tenant_automics_labs: 'a0000000-0000-0000-0000-000000000002',
};

function toDbTenantId(id: string): string {
  if (!id) return DEFAULT_TENANT_ID;
  if (TENANT_UUID_MAP[id]) return TENANT_UUID_MAP[id];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  return DEFAULT_TENANT_ID;
}

// In-memory fallback
const IN_MEMORY_SUBSCRIPTIONS: Record<string, TenantSubscriptionInfo> = {
  tenant_bring_my_bite: {
    tenantId: 'tenant_bring_my_bite',
    planId: 'growth',
    planName: 'Growth Plan',
    status: 'active',
    billingProvider: 'mock',
    limits: PLAN_DEFINITIONS.growth.limits,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  },
};

// 1. GET /api/billing/plans - List All Available SaaS Plans
router.get('/plans', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: Object.values(PLAN_DEFINITIONS),
    meta: { requestId: req.requestId },
  });
});

// 2. GET /api/billing/subscription - Get Current Tenant Subscription
router.get('/subscription', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const sub = IN_MEMORY_SUBSCRIPTIONS[rawTenantId] || {
      tenantId: rawTenantId,
      planId: 'starter',
      planName: 'Starter Plan',
      status: 'trial',
      billingProvider: 'mock',
      limits: PLAN_DEFINITIONS.starter.limits,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };

    res.json({ success: true, data: sub, meta: { requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT 
         tenant_id as "tenantId", plan_id as "planId", plan_name as "planName",
         status, billing_provider as "billingProvider", limits,
         current_period_start as "currentPeriodStart", current_period_end as "currentPeriodEnd",
         trial_ends_at as "trialEndsAt"
       FROM tenant_subscriptions
       WHERE tenant_id = $1 LIMIT 1;`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      const def = PLAN_DEFINITIONS.starter;
      res.json({
        success: true,
        data: {
          tenantId: rawTenantId,
          planId: 'starter',
          planName: def.name,
          status: 'trial',
          billingProvider: 'mock',
          limits: def.limits,
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        },
        meta: { requestId },
      });
      return;
    }

    res.json({ success: true, data: result.rows[0], meta: { requestId } });
  } catch (error: any) {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is temporarily unavailable. Please retry shortly.',
        requestId: requestId,
      },
    });
    return;
  }
});

// 3. POST /api/billing/change-plan - Upgrade / Downgrade Plan Tier
router.post('/change-plan', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { planId } = req.body;

  if (!planId || !PLAN_DEFINITIONS[planId as PlanTier]) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_PLAN', message: 'Valid planId is required (starter, growth, enterprise).', requestId },
    });
    return;
  }

  const selected = PLAN_DEFINITIONS[planId as PlanTier];
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const updated: TenantSubscriptionInfo = {
      tenantId: rawTenantId,
      planId: selected.id,
      planName: selected.name,
      status: 'active',
      billingProvider: 'mock',
      limits: selected.limits,
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    };
    IN_MEMORY_SUBSCRIPTIONS[rawTenantId] = updated;
    res.json({ success: true, data: updated, meta: { requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO tenant_subscriptions (
         tenant_id, plan_id, plan_name, status, billing_provider, limits,
         current_period_start, current_period_end, updated_at
       ) VALUES ($1, $2, $3, 'active', 'mock', $4, NOW(), NOW() + INTERVAL '30 days', NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET 
         plan_id = $2, plan_name = $3, status = 'active', limits = $4,
         current_period_end = NOW() + INTERVAL '30 days', updated_at = NOW()
       RETURNING tenant_id as "tenantId", plan_id as "planId", plan_name as "planName", status, limits;`,
      [tenantId, selected.id, selected.name, JSON.stringify(selected.limits)]
    );

    res.json({ success: true, data: result.rows[0], meta: { requestId } });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({ success: false, error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: error.message, requestId } });
  }
});

// 4. POST /api/billing/webhook - Webhook Event Ingestion (Idempotent)
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const provider = (req.headers['x-billing-provider'] as any) || 'mock';
  const adapter = getBillingAdapter(provider);
  const signature = (req.headers['stripe-signature'] || req.headers['x-razorpay-signature'] || '') as string;

  const event = adapter.parseWebhookEvent(req.body);

  if (!event) {
    res.status(400).json({ success: false, error: 'Unrecognized webhook event payload.' });
    return;
  }

  const rawTenantId = event.tenantId;
  const tenantId = toDbTenantId(rawTenantId);
  const plan = PLAN_DEFINITIONS[event.planId] || PLAN_DEFINITIONS.starter;

  const dbConfig = resolveDatabaseConfig();
  if (dbConfig.isBlocked) {
    if (IN_MEMORY_SUBSCRIPTIONS[rawTenantId]) {
      IN_MEMORY_SUBSCRIPTIONS[rawTenantId].status = event.status;
      IN_MEMORY_SUBSCRIPTIONS[rawTenantId].planId = event.planId;
      IN_MEMORY_SUBSCRIPTIONS[rawTenantId].planName = plan.name;
    }
    res.status(200).json({ success: true, eventId: event.eventId, processed: true });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO tenant_subscriptions (
         tenant_id, plan_id, plan_name, status, billing_provider, limits, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET plan_id = $2, plan_name = $3, status = $4, limits = $6, updated_at = NOW();`,
      [tenantId, event.planId, plan.name, event.status, event.provider, JSON.stringify(plan.limits)]
    );

    res.status(200).json({ success: true, eventId: event.eventId, processed: true });
  } catch {
    res.status(200).json({ success: true, processed: false });
  }
});

export default router;
