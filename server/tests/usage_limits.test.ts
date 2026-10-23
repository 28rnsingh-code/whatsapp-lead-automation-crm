import crypto from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { pool, resolveDatabaseConfig } from '../src/db';
import {
  PlanQuotaExceededError,
  SubscriptionAccessError,
  reconcileMonthlyUsage,
  releaseMonthlyUsage,
  reserveMonthlyUsage,
} from '../src/services/billing/usageMetering';

const createdTenantIds: string[] = [];
const TEST_PERIOD = '2099-07';

async function createQuotaTenant(overrides: Record<string, number> = {}, status = 'active'): Promise<string> {
  const db = resolveDatabaseConfig();
  if (process.env.NODE_ENV !== 'test' || db.isBlocked || !db.databaseName.toLowerCase().includes('test')) {
    throw new Error('Refusing to create plan quota test data outside the isolated test database.');
  }

  const tenantId = crypto.randomUUID();
  const slug = 'quota-test-' + crypto.randomUUID();
  await pool.query(
    "INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'Quota Test Workspace', $2, 'active')",
    [tenantId, slug],
  );
  const limits = {
    maxMembers: 2,
    maxLeads: 100,
    maxImportsPerMonth: 2,
    maxMessagesPerMonth: 2,
    maxAiTokens: 10,
    ...overrides,
  };
  await pool.query(
    `INSERT INTO tenant_subscriptions (
       tenant_id, plan_id, plan_name, status, billing_provider, limits,
       current_period_start, current_period_end
     ) VALUES ($1, 'starter', 'Quota Test', $2, 'mock', $3::jsonb, NOW(), NOW() + INTERVAL '30 days')`,
    [tenantId, status, JSON.stringify(limits)],
  );
  createdTenantIds.push(tenantId);
  return tenantId;
}

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
  }
});

describe('Monthly plan quota enforcement', () => {
  it('serializes concurrent message reservations and never permits more than the configured monthly limit', async () => {
    const tenantId = await createQuotaTenant({ maxMessagesPerMonth: 2 });
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, () => reserveMonthlyUsage(tenantId, 'messages', 1, TEST_PERIOD)),
    );

    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(5);
    expect(rejected.every(result => result.status === 'rejected' && result.reason instanceof PlanQuotaExceededError)).toBe(true);
    expect(fulfilled.map(result => result.status === 'fulfilled' ? result.value.usedAfter : 0).sort()).toEqual([1, 2]);
  });

  it('reserves, releases and reconciles monthly import usage', async () => {
    const tenantId = await createQuotaTenant({ maxImportsPerMonth: 2 });
    const reservation = await reserveMonthlyUsage(tenantId, 'imports', 1, TEST_PERIOD);
    expect(reservation.usedAfter).toBe(1);

    await releaseMonthlyUsage(reservation);
    const afterRelease = await reserveMonthlyUsage(tenantId, 'imports', 2, TEST_PERIOD);
    expect(afterRelease.usedAfter).toBe(2);

    await expect(reserveMonthlyUsage(tenantId, 'imports', 1, TEST_PERIOD)).rejects.toBeInstanceOf(PlanQuotaExceededError);
  });

  it('reconciles an AI token estimate to actual usage and blocks later requests after the cap is reached', async () => {
    const tenantId = await createQuotaTenant({ maxAiTokens: 10 });
    const reservation = await reserveMonthlyUsage(tenantId, 'aiTokens', 6, TEST_PERIOD);
    await reconcileMonthlyUsage(reservation, 9);

    const finalToken = await reserveMonthlyUsage(tenantId, 'aiTokens', 1, TEST_PERIOD);
    expect(finalToken.usedAfter).toBe(10);
    await expect(reserveMonthlyUsage(tenantId, 'aiTokens', 1, TEST_PERIOD)).rejects.toBeInstanceOf(PlanQuotaExceededError);
  });

  it('blocks new billable usage for suspended or cancelled subscriptions', async () => {
    const tenantId = await createQuotaTenant({}, 'suspended');
    await expect(reserveMonthlyUsage(tenantId, 'messages', 1, TEST_PERIOD)).rejects.toBeInstanceOf(SubscriptionAccessError);
  });

  it('uses the current India-local calendar month as its usage period', async () => {
    const tenantId = await createQuotaTenant();
    const result = await reserveMonthlyUsage(tenantId, 'messages', 1);
    expect(result.periodKey).toMatch(/^\d{4}-\d{2}$/);
  });
});
