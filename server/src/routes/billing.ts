import { Router, Request, Response } from 'express';
import crypto from 'crypto';
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
    res.json({
      success: true,
      data: IN_MEMORY_SUBSCRIPTIONS.tenant_bring_my_bite,
      meta: { requestId },
    });
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

// 4. POST /api/billing/webhook - verify signatures and process each provider event once.
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const providerHeader = req.headers['x-billing-provider'];
  const provider = typeof providerHeader === 'string' ? providerHeader.trim().toLowerCase() : '';
  if (!provider) {
    res.status(400).json({ success: false, error: { code: 'BILLING_PROVIDER_REQUIRED', message: 'Set x-billing-provider to a configured provider.', requestId } });
    return;
  }

  if (provider === 'mock' && process.env.NODE_ENV === 'production') {
    res.status(404).json({ success: false, error: { code: 'BILLING_PROVIDER_UNAVAILABLE', message: 'Mock billing webhooks are disabled in production.', requestId } });
    return;
  }

  let adapter;
  try {
    adapter = getBillingAdapter(provider as any);
  } catch {
    res.status(501).json({ success: false, error: { code: 'BILLING_PROVIDER_UNSUPPORTED', message: 'This billing provider is not implemented in the current release.', requestId } });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signatureHeader = provider === 'stripe'
    ? req.headers['stripe-signature']
    : provider === 'mock' ? req.headers['x-mock-billing-signature'] : req.headers['x-razorpay-signature'];
  const signature = typeof signatureHeader === 'string' ? signatureHeader : '';
  const secret = provider === 'stripe' ? process.env.STRIPE_WEBHOOK_SECRET
    : provider === 'mock' ? process.env.MOCK_BILLING_WEBHOOK_SECRET
    : process.env.RAZORPAY_WEBHOOK_SECRET;

  // Unit tests may use the explicit mock adapter without a secret. All non-test
  // delivery paths must be authenticated with an HMAC signature over raw request bytes.
  if (!(provider === 'mock' && process.env.NODE_ENV === 'test')) {
    if (!secret) {
      res.status(503).json({ success: false, error: { code: 'BILLING_WEBHOOK_NOT_CONFIGURED', message: 'The billing webhook secret is missing from the server environment.', requestId } });
      return;
    }
    if (!rawBody || !signature || !adapter.verifyWebhookSignature(rawBody, signature, secret)) {
      res.status(401).json({ success: false, error: { code: 'BILLING_SIGNATURE_INVALID', message: 'The billing webhook signature is missing or invalid.', requestId } });
      return;
    }
  }

  const event = adapter.parseWebhookEvent(req.body);
  if (!event) {
    res.status(400).json({ success: false, error: { code: 'BILLING_EVENT_INVALID', message: 'The billing provider event is unrecognized or lacks required workspace/plan metadata.', requestId } });
    return;
  }
  if (event.provider !== provider || !event.eventId || !['subscription.created', 'subscription.renewed', 'subscription.cancelled', 'payment.failed'].includes(event.eventType) || !PLAN_DEFINITIONS[event.planId as PlanTier] || !['trial', 'active', 'past_due', 'cancelled', 'suspended'].includes(event.status)) {
    res.status(400).json({ success: false, error: { code: 'BILLING_EVENT_INVALID', message: 'The billing provider event contains unsupported provider, plan or subscription state values.', requestId } });
    return;
  }

  const rawTenantId = event.tenantId;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tenantId = TENANT_UUID_MAP[rawTenantId] || (uuidPattern.test(rawTenantId) ? rawTenantId : null);
  if (!tenantId) {
    res.status(400).json({ success: false, error: { code: 'BILLING_TENANT_INVALID', message: 'The signed billing event does not identify a valid workspace.', requestId } });
    return;
  }

  if (resolveDatabaseConfig().isBlocked) {
    res.status(503).json({ success: false, error: { code: 'BILLING_DATABASE_UNAVAILABLE', message: 'Billing events cannot be processed without persistent storage.', requestId } });
    return;
  }

  const plan = PLAN_DEFINITIONS[event.planId as PlanTier];
  const payloadHash = crypto.createHash('sha256').update(rawBody || Buffer.from(JSON.stringify(req.body))).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (tenant.rowCount !== 1) {
      await client.query('ROLLBACK');
      res.status(404).json({ success: false, error: { code: 'BILLING_TENANT_NOT_FOUND', message: 'The billing event workspace was not found.', requestId } });
      return;
    }

    const inserted = await client.query(
      `INSERT INTO billing_webhook_events (provider, event_id, tenant_id, event_type, event_timestamp, payload_sha256, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'received')
       ON CONFLICT (provider, event_id) DO NOTHING
       RETURNING id`,
      [provider, event.eventId, tenantId, event.eventType, event.timestamp, payloadHash],
    );
    if (inserted.rowCount !== 1) {
      await client.query('COMMIT');
      res.status(200).json({ success: true, eventId: event.eventId, processed: false, duplicate: true, requestId });
      return;
    }

    await client.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, plan_name, status, billing_provider, limits, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, plan_name = EXCLUDED.plan_name,
         status = EXCLUDED.status, billing_provider = EXCLUDED.billing_provider,
         limits = EXCLUDED.limits, updated_at = NOW()`,
      [tenantId, event.planId, plan.name, event.status, provider, JSON.stringify(plan.limits)],
    );
    await client.query(
      `UPDATE billing_webhook_events SET processing_status = 'processed', processed_at = NOW() WHERE provider = $1 AND event_id = $2`,
      [provider, event.eventId],
    );
    await client.query('COMMIT');
    res.status(200).json({ success: true, eventId: event.eventId, processed: true, duplicate: false, requestId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[Billing Webhook] Verified event processing failed', { requestId, provider, error });
    res.status(503).json({ success: false, error: { code: 'BILLING_EVENT_PROCESSING_FAILED', message: 'The verified billing event could not be committed. Provider delivery can be retried safely.', requestId } });
  } finally {
    client.release();
  }
});

export default router;
