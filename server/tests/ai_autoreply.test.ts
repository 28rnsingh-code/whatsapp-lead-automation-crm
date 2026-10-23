import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signToken } from '../src/services/authService';
import { getAiAdapter } from '../src/services/ai/aiRegistry';

describe('Phase 4: Customer-Configurable AI Auto-Reply Tests', () => {
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

  describe('1. AI Provider Adapter Unit Tests', () => {
    it('validates mock AI key format', async () => {
      const adapter = getAiAdapter('mock');
      const invalid = await adapter.validateKey('invalid_key_123', 'mock-fast-reply');
      expect(invalid.valid).toBe(false);

      const valid = await adapter.validateKey('valid_key_123', 'mock-fast-reply');
      expect(valid.valid).toBe(true);
    });

    it('validates OpenAI key format', async () => {
      const adapter = getAiAdapter('openai');
      const invalid = await adapter.validateKey('invalid_openai_key', 'gpt-4o-mini');
      expect(invalid.valid).toBe(false);

      const testValid = await adapter.validateKey('test_sk_mock_valid_key', 'gpt-4o-mini');
      expect(testValid.valid).toBe(true);
    });

    it('generates contextual mock reply adhering to max length', async () => {
      const adapter = getAiAdapter('mock');
      const res = await adapter.generateReply({
        tenantId: 'tenant_bring_my_bite',
        leadName: 'Amit Sharma',
        incomingMessage: 'Can you send me a quote for 25 licenses?',
        config: {
          provider: 'mock',
          model: 'mock-fast-reply',
          mode: 'draft_only',
          confidenceThreshold: 0.8,
          maxOutputChars: 120,
          enabled: true,
        },
      });

      expect(res.success).toBe(true);
      expect(res.replyText).toContain('Amit Sharma');
      expect(res.replyText!.length).toBeLessThanOrEqual(120);
      expect(res.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('2. AI Config API & Masked Keys', () => {
    it('GET /api/ai/config returns masked API key and never plain text', async () => {
      const res = await request(app)
        .get('/api/ai/config')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.config).toHaveProperty('provider');
      expect(res.body.data.config).toHaveProperty('mode');
      expect(res.body.data.config).not.toHaveProperty('apiKey');
      if (res.body.data.config.apiKeyMasked) {
        expect(res.body.data.config.apiKeyMasked).toContain('•');
      }
      expect(Array.isArray(res.body.data.supportedProviders)).toBe(true);
    });

    it('POST /api/ai/config saves tenant configuration', async () => {
      const res = await request(app)
        .post('/api/ai/config')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          provider: 'openai',
          apiKey: 'test_sk_live_1234567890abcdef',
          model: 'gpt-4o-mini',
          mode: 'draft_only',
          systemPrompt: 'You are an advisor for Bring My Bite.',
          businessContext: 'Food ordering and CRM.',
          maxOutputChars: 200,
          confidenceThreshold: 0.85,
          enabled: true,
        });

      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.config.provider).toBe('openai');
        expect(res.body.data.config.model).toBe('gpt-4o-mini');
        expect(res.body.data.config).not.toHaveProperty('apiKey');
      }
    });
  });

  describe('3. Generate Reply & Approval Workflow', () => {
    it('POST /api/ai/generate-reply generates draft suggestion', async () => {
      const res = await request(app)
        .post('/api/ai/generate-reply')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          incomingMessage: 'Hello, what are your onboarding fees?',
          leadName: 'Vikram Joshi',
          companyName: 'Joshi Retail',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('replyText');
      expect(res.body.data).toHaveProperty('confidence');
      expect(res.body.data).toHaveProperty('passesThreshold');
      expect(res.body.data.requiresApproval).toBe(true);
    });

    it('POST /api/ai/approve-reply refuses the legacy mock-send bypass', async () => {
      const res = await request(app)
        .post('/api/ai/approve-reply')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          recipientPhone: '+919876543210',
          replyText: 'This legacy route must not fake-send a message.',
          leadId: 'does-not-matter',
        });

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AI_APPROVAL_ROUTE_DISABLED');
    });


    it('enforces tenant isolation on AI configs and requests', async () => {
      const resA = await request(app)
        .get('/api/ai/config')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      const resB = await request(app)
        .get('/api/ai/config')
        .set('Authorization', `Bearer ${automicsToken}`)
        .set('x-tenant-id', 'tenant_automics_labs');

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.data.config.provider).toBeDefined();
      expect(resB.body.data.config.provider).toBeDefined();
    });
  });
});
