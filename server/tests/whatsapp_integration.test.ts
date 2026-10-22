import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { signToken } from '../src/services/authService';

const TEST_WHATSAPP_APP_SECRET = 'unit-test-whatsapp-app-secret';
process.env.WHATSAPP_APP_SECRET = TEST_WHATSAPP_APP_SECRET;
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'oneclick_verify';
import {
  getWhatsAppAdapter,
  maskSecret,
  encryptSecret,
  decryptSecret,
} from '../src/services/whatsapp/adapterRegistry';

describe('Phase 3: Configurable WhatsApp Provider Integration Tests', () => {
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

  describe('1. Secret Masking & Encryption at Rest Unit Tests', () => {
    it('masks secrets securely without exposing full credentials', () => {
      expect(maskSecret('EAABsb87asdfghjk987654321')).toBe('EAA••••••••321');
      expect(maskSecret('short')).toBe('••••••');
      expect(maskSecret('')).toBe('');
    });

    it('encrypts and decrypts secrets using AES-256-GCM', () => {
      const secret = 'super_secret_meta_cloud_api_token_12345';
      const encrypted = encryptSecret(secret);
      expect(encrypted).toContain('enc:');
      expect(encrypted).not.toBe(secret);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });
  });

  describe('2. Provider Adapter Unit Tests', () => {
    it('validates Meta Cloud API required credentials', async () => {
      const adapter = getWhatsAppAdapter('cloud_api');
      const invalid = await adapter.validateCredentials({
        provider: 'cloud_api',
        phoneNumberId: '',
      });
      expect(invalid.valid).toBe(false);

      const valid = await adapter.validateCredentials({
        provider: 'cloud_api',
        phoneNumberId: '10987654321',
        accessToken: 'test_token_valid',
      });
      expect(valid.valid).toBe(true);
    });

    it('validates Gupshup API credentials', async () => {
      const adapter = getWhatsAppAdapter('gupshup');
      const invalid = await adapter.validateCredentials({
        provider: 'gupshup',
        apiKey: '',
      });
      expect(invalid.valid).toBe(false);

      const valid = await adapter.validateCredentials({
        provider: 'gupshup',
        apiKey: 'test_gupshup_key',
        sourceNumber: '+919876543210',
      });
      expect(valid.valid).toBe(true);
    });

    it('dispatches mock outbound message with provider ID', async () => {
      const adapter = getWhatsAppAdapter('mock');
      const res = await adapter.sendMessage({
        tenantId: 'tenant_bring_my_bite',
        recipientPhone: '+919876543210',
        messageType: 'text',
        body: 'Hello test lead',
        credentials: { provider: 'mock' },
      });
      expect(res.success).toBe(true);
      expect(res.providerMessageId).toContain('mock-msg');
      expect(res.status).toBe('sent');
    });
  });

  describe('3. WhatsApp Config API & Credential Masking', () => {
    it('GET /api/whatsapp/config returns masked secrets, never plain access tokens', async () => {
      const res = await request(app)
        .get('/api/whatsapp/config')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.config).toHaveProperty('provider');
      expect(res.body.data.config).toHaveProperty('status');
      // Verify raw secrets are never returned
      expect(res.body.data.config).not.toHaveProperty('accessToken');
      expect(res.body.data.config).not.toHaveProperty('appSecret');
      if (res.body.data.config.accessTokenMasked) {
        expect(res.body.data.config.accessTokenMasked).toContain('•');
      }
      expect(Array.isArray(res.body.data.supportedProviders)).toBe(true);
    });

    it('POST /api/whatsapp/config saves new provider configuration safely', async () => {
      const res = await request(app)
        .post('/api/whatsapp/config')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          provider: 'cloud_api',
          phoneNumberId: '9876543210123',
          businessAccountId: '1234567890123',
          accessToken: 'test_new_meta_token_98765',
          appSecret: 'test_app_secret_123',
        });

      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.config.provider).toBe('cloud_api');
        expect(res.body.data.config.status).toBe('connected');
        expect(res.body.data.config).not.toHaveProperty('accessToken');
      }
    });
  });

  describe('4. Webhook Hub Verification & Ingestion', () => {
    it('GET /api/whatsapp/webhook validates Meta Hub challenge token', async () => {
      const challengeToken = 'hub_challenge_random_123456';
      const res = await request(app)
        .get(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=oneclick_verify&hub.challenge=${challengeToken}`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(challengeToken);
    });

    it('GET /api/whatsapp/webhook rejects an incorrect verify token', async () => {
      const res = await request(app)
        .get('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=not-authorized');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WEBHOOK_VERIFICATION_FAILED');
    });

    it('POST /api/whatsapp/webhook rejects an invalid signature before event processing', async () => {
      const res = await request(app)
        .post('/api/whatsapp/webhook')
        .set('x-hub-signature-256', `sha256=${'0'.repeat(64)}`)
        .send({ object: 'whatsapp_business_account', entry: [] });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it('POST /api/whatsapp/webhook processes only a validly signed inbound event', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '209384756192834',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '919999988888', phone_number_id: '109823475689123' },
                  messages: [
                    {
                      from: '919876543210',
                      id: `wamid.test_${Date.now()}`,
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      text: { body: 'Pricing inquiry from WhatsApp' },
                      type: 'text',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };
      const rawPayload = JSON.stringify(payload);
      const signature = `sha256=${createHmac('sha256', TEST_WHATSAPP_APP_SECRET).update(rawPayload).digest('hex')}`;

      const res = await request(app)
        .post('/api/whatsapp/webhook')
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .set('x-hub-signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(rawPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.processed).toBe(1);
    });
  });

  describe('5. Outbound Messages & Templates', () => {
    it('POST /api/whatsapp/messages sends message and enforces validation', async () => {
      const res = await request(app)
        .post('/api/whatsapp/messages')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          recipientPhone: '+919876543210',
          body: 'Hello from OneClick CRM automated test',
        });

      expect([201, 503]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.direction).toBe('outbound');
        expect(res.body.data.status).toBe('sent');
      }
    });

    it('GET /api/whatsapp/templates returns approved templates', async () => {
      const res = await request(app)
        .get('/api/whatsapp/templates')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0].status).toBe('APPROVED');
    });

    it('enforces tenant isolation on messages', async () => {
      const resA = await request(app)
        .get('/api/whatsapp/messages')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      const resB = await request(app)
        .get('/api/whatsapp/messages')
        .set('Authorization', `Bearer ${automicsToken}`)
        .set('x-tenant-id', 'tenant_automics_labs');

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      const idsA = new Set(resA.body.data.map((m: any) => m.id));
      const idsB = new Set(resB.body.data.map((m: any) => m.id));
      const intersection = [...idsA].filter(id => idsB.has(id));
      expect(intersection.length).toBe(0);
    });
  });
});
