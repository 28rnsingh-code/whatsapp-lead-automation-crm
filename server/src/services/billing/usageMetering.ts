import { PoolClient } from 'pg';
import { pool } from '../../db';
import { PLAN_DEFINITIONS, PlanLimits, PlanTier } from './types';

export type MonthlyUsageMetric = 'messages' | 'imports' | 'aiTokens';

const METRICS: Record<MonthlyUsageMetric, {
  column: 'messages_count' | 'imports_count' | 'ai_tokens_count';
  limitKey: 'maxMessagesPerMonth' | 'maxImportsPerMonth' | 'maxAiTokens';
}> = {
  messages: { column: 'messages_count', limitKey: 'maxMessagesPerMonth' },
  imports: { column: 'imports_count', limitKey: 'maxImportsPerMonth' },
  aiTokens: { column: 'ai_tokens_count', limitKey: 'maxAiTokens' },
};

export class PlanQuotaExceededError extends Error {
  readonly code = 'PLAN_QUOTA_EXCEEDED';
  readonly status = 429;

  constructor(
    readonly metric: MonthlyUsageMetric,
    readonly limit: number,
    readonly used: number,
    readonly requested: number,
  ) {
    super('PLAN_QUOTA_EXCEEDED');
    this.name = 'PlanQuotaExceededError';
  }
}

export class SubscriptionAccessError extends Error {
  readonly code = 'SUBSCRIPTION_INACTIVE';
  readonly status = 402;

  constructor(readonly subscriptionStatus: string) {
    super('SUBSCRIPTION_INACTIVE');
    this.name = 'SubscriptionAccessError';
  }
}

export interface MonthlyUsageReservation {
  tenantId: string;
  periodKey: string;
  metric: MonthlyUsageMetric;
  amount: number;
  limit: number;
  usedAfter: number;
}

export function getCurrentUsagePeriodKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Could not resolve current usage period.');
  return `${year}-${month}`;
}

function parseLimits(value: unknown): Partial<PlanLimits> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Partial<PlanLimits>;
}

async function readPlanLimits(client: PoolClient, tenantId: string): Promise<{ planId: PlanTier; limits: PlanLimits; status: string }> {
  const result = await client.query(
    'SELECT plan_id, plan_name, status, limits FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1',
    [tenantId],
  );
  const row = result.rows[0];
  const suppliedPlanId = row?.plan_id;
  const planId: PlanTier = suppliedPlanId && suppliedPlanId in PLAN_DEFINITIONS
    ? suppliedPlanId as PlanTier
    : 'starter';
  const defaults = PLAN_DEFINITIONS[planId].limits;
  const supplied = parseLimits(row?.limits);
  const numericOrDefault = (key: keyof PlanLimits): number => {
    const value = Number(supplied[key]);
    return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : defaults[key];
  };
  return {
    planId,
    status: String(row?.status || 'trial'),
    limits: {
      maxMembers: numericOrDefault('maxMembers'),
      maxLeads: numericOrDefault('maxLeads'),
      maxImportsPerMonth: numericOrDefault('maxImportsPerMonth'),
      maxMessagesPerMonth: numericOrDefault('maxMessagesPerMonth'),
      maxAiTokens: numericOrDefault('maxAiTokens'),
    },
  };
}

/**
 * Atomically reserve monthly usage. A tenant-row lock serializes cross-metric
 * reservations for one workspace. The UPDATE predicate is an additional guard
 * against exceeding a quota if another writer does not use this helper.
 */
export async function reserveMonthlyUsage(
  tenantId: string,
  metric: MonthlyUsageMetric,
  amount = 1,
  periodKey = getCurrentUsagePeriodKey(),
): Promise<MonthlyUsageReservation> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Usage reservation amount must be a positive integer.');
  if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new Error('Usage period must use YYYY-MM.');

  const config = METRICS[metric];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (tenant.rowCount !== 1) throw new Error('WORKSPACE_NOT_FOUND');

    const plan = await readPlanLimits(client, tenantId);
    if (plan.status === 'cancelled' || plan.status === 'suspended') {
      throw new SubscriptionAccessError(plan.status);
    }
    const limit = plan.limits[config.limitKey];

    await client.query(
      'INSERT INTO tenant_usage (tenant_id, period_key) VALUES ($1, $2) ON CONFLICT (tenant_id, period_key) DO NOTHING',
      [tenantId, periodKey],
    );
    const currentResult = await client.query(
      `SELECT ${config.column} AS used FROM tenant_usage WHERE tenant_id = $1 AND period_key = $2 LIMIT 1`,
      [tenantId, periodKey],
    );
    const used = Number(currentResult.rows[0]?.used || 0);
    if (used + amount > limit) {
      throw new PlanQuotaExceededError(metric, limit, used, amount);
    }

    const update = await client.query(
      `UPDATE tenant_usage
       SET ${config.column} = ${config.column} + $3, updated_at = NOW()
       WHERE tenant_id = $1 AND period_key = $2
         AND ${config.column} + $3 <= $4
       RETURNING ${config.column} AS used`,
      [tenantId, periodKey, amount, limit],
    );
    if (update.rowCount !== 1) {
      const latest = await client.query(
        `SELECT ${config.column} AS used FROM tenant_usage WHERE tenant_id = $1 AND period_key = $2 LIMIT 1`,
        [tenantId, periodKey],
      );
      throw new PlanQuotaExceededError(metric, limit, Number(latest.rows[0]?.used || 0), amount);
    }

    const usedAfter = Number(update.rows[0].used);
    await client.query('COMMIT');
    return { tenantId, periodKey, metric, amount, limit, usedAfter };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Reverse a reservation when an operation definitively failed before consuming the resource. */
export async function releaseMonthlyUsage(reservation: MonthlyUsageReservation, amount = reservation.amount): Promise<void> {
  const config = METRICS[reservation.metric];
  if (!Number.isInteger(amount) || amount <= 0) return;
  await pool.query(
    `UPDATE tenant_usage
     SET ${config.column} = GREATEST(0, ${config.column} - $3), updated_at = NOW()
     WHERE tenant_id = $1 AND period_key = $2`,
    [reservation.tenantId, reservation.periodKey, amount],
  );
}
