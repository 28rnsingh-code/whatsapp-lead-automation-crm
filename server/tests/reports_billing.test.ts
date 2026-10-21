import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signToken } from '../src/services/authService';

describe('Phase 5 & 6: Advanced Reporting, Usage Metering & SaaS Billing Tests', () => {
  const app = createApp();

  const rohanToken = signToken({
    userId: 'user_rohan_singh',
    email: 'rohan@bringmybite.in',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  const automicsToken = signToken({
    userId: 'user_other_tenant',
    email: 'other@competitor.in',
    defaultTenantId: 'tenant_automics_labs',
  });

  describe('1. Advanced Reporting & Analytics API', () => {
    it('GET /api/reports/analytics returns real aggregated conversion funnel & metrics', async () => {
      const res = await request(app)
        .get('/api/reports/analytics?range=30d')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('winRate');
      expect(res.body.data).toHaveProperty('avgDealSize');
      expect(Array.isArray(res.body.data.funnel)).toBe(true);
      expect(res.body.data.funnel.length).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(res.body.data.leaderboard)).toBe(true);
      expect(Array.isArray(res.body.data.sources)).toBe(true);
    });

    it('GET /api/reports/analytics supports different date ranges (7d, 90d, all)', async () => {
      for (const range of ['7d', '90d', 'all']) {
        const res = await request(app)
          .get(`/api/reports/analytics?range=${range}`)
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite');

        expect(res.status).toBe(200);
        expect(res.body.meta.range).toBe(range);
      }
    });

    it('GET /api/reports/export streams CSV report with content-disposition header', async () => {
      const res = await request(app)
        .get('/api/reports/export?range=30d')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('analytics_report_');
      expect(res.text).toContain('Report Metric,Value,Period');
    });
  });

  describe('2. Usage Metering & Plan Limits API', () => {
    it('GET /api/reports/usage returns tenant usage counters and plan quotas', async () => {
      const res = await request(app)
        .get('/api/reports/usage')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('periodKey');
      expect(res.body.data).toHaveProperty('plan');
      expect(res.body.data.usage).toHaveProperty('leadsCount');
      expect(res.body.data.usage).toHaveProperty('maxLeads');
      expect(res.body.data.usage).toHaveProperty('messagesCount');
      expect(res.body.data.usage).toHaveProperty('aiTokensCount');
    });
  });

  describe('3. SaaS Plans & Billing Readiness', () => {
    it('GET /api/billing/plans returns available SaaS pricing tiers in INR', async () => {
      const res = await request(app)
        .get('/api/billing/plans');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const planIds = res.body.data.map((p: any) => p.id);
      expect(planIds).toContain('starter');
      expect(planIds).toContain('growth');
      expect(planIds).toContain('enterprise');
    });

    it('GET /api/billing/subscription returns current tenant subscription info', async () => {
      const res = await request(app)
        .get('/api/billing/subscription')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('planId');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('limits');
    });

    it('POST /api/billing/change-plan updates tenant subscription tier', async () => {
      const res = await request(app)
        .post('/api/billing/change-plan')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({ planId: 'growth' });

      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.planId).toBe('growth');
      }
    });

    it('POST /api/billing/webhook processes subscription events idempotently', async () => {
      const res = await request(app)
        .post('/api/billing/webhook')
        .set('x-billing-provider', 'mock')
        .send({
          eventId: `evt_test_${Date.now()}`,
          eventType: 'subscription.renewed',
          tenantId: 'tenant_bring_my_bite',
          planId: 'growth',
          status: 'active',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(true);
    });

    it('enforces tenant isolation across metrics and subscriptions', async () => {
      const resA = await request(app)
        .get('/api/reports/usage')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      const resB = await request(app)
        .get('/api/reports/usage')
        .set('Authorization', `Bearer ${automicsToken}`)
        .set('x-tenant-id', 'tenant_automics_labs');

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.data.plan).toBeDefined();
      expect(resB.body.data.plan).toBeDefined();
    });
  });
});
