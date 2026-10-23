import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { signToken } from '../src/services/authService';
import { pool } from '../src/db';
import { DEFAULT_TENANT_ID } from '../src/db/seed';
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

  const configureTestWhatsApp = async () => {
    const config = await request(app)
      .post('/api/whatsapp/config')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        provider: 'cloud_api',
        phoneNumberId: '9876543210123',
        businessAccountId: '1234567890123',
        accessToken: 'test_new_meta_token_98765',
        appSecret: 'test_app_secret_123',
        webhookVerifyToken: 'test_webhook_verify_123',
      });
    expect(config.status).toBe(200);
    expect(config.body.data.config.status).toBe('connected');
  };

  const createTestLead = async () => {
    const suffix = String(Date.now()).slice(-9).padStart(9, '7');
    const phoneDigits = `9${suffix}`;
    const phone = `+91${phoneDigits}`;
    const response = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        name: `WhatsApp Test Lead ${suffix}`,
        phoneRaw: phone,
        email: '',
        companyName: 'QA Test Workspace',
        source: 'WhatsApp',
        dealValue: '0',
        nextAction: 'WhatsApp follow-up',
        notes: 'Isolated automated test data',
      });
    expect(response.status).toBe(201);
    expect(response.body.data.consentStatus).toBe('Unknown');
    return { lead: response.body.data, phone, phoneDigits };
  };

  const signWebhook = (payload: unknown) =>
    `sha256=${createHmac('sha256', 'test_app_secret_123').update(JSON.stringify(payload)).digest('hex')}`;

  const cleanupTestLead = async (leadId: string, phone: string) => {
    await pool.query(
      `DELETE FROM whatsapp_messages WHERE tenant_id = $1 AND (lead_id = $2 OR sender_phone = $3 OR recipient_phone = $3)`,
      [DEFAULT_TENANT_ID, leadId, phone],
    );
    await pool.query(
      `DELETE FROM activities WHERE tenant_id = $1 AND entity_id::text = $2`,
      [DEFAULT_TENANT_ID, leadId],
    );
    await pool.query(`DELETE FROM leads WHERE tenant_id = $1 AND id::text = $2`, [DEFAULT_TENANT_ID, leadId]);
  };

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
    it('GET /api/whatsapp/webhook echoes the challenge only for a persisted matching verification token', async () => {
      await configureTestWhatsApp();
      const challengeToken = 'hub_challenge_valid_987654';
      const res = await request(app)
        .get('/api/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test_webhook_verify_123',
          'hub.challenge': challengeToken,
        });

      expect(res.status).toBe(200);
      expect(res.text).toBe(challengeToken);
    });

    it('GET /api/whatsapp/webhook rejects unconfigured verification tokens', async () => {
      const challengeToken = 'hub_challenge_random_123456';
      const res = await request(app)
        .get(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=unconfigured-token&hub.challenge=${challengeToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WEBHOOK_VERIFICATION_DENIED');
    });

    it('acknowledges signed status callbacks that do not belong to a CRM outbound message', async () => {
      await configureTestWhatsApp();
      const payload = {
        object: 'whatsapp_business_account',
        entry: [{
          id: '209384756192834',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '919999988888', phone_number_id: '9876543210123' },
              statuses: [{
                id: `wamid.external_${Date.now()}`,
                status: 'delivered',
                recipient_id: '919876543210',
                timestamp: `${Math.floor(Date.now() / 1000)}`,
              }],
            },
            field: 'messages',
          }],
        }],
      };
      const res = await request(app)
        .post('/api/whatsapp/webhook')
        .set('x-hub-signature-256', signWebhook(payload))
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.processed).toBe(0);
    });

    it('POST /api/whatsapp/webhook rejects unsigned events even when a tenant header is provided', async () => {
      await configureTestWhatsApp();
      const res = await request(app)
        .post('/api/whatsapp/webhook')
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          object: 'whatsapp_business_account',
          entry: [{
            id: '209384756192834',
            changes: [{
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '919999988888', phone_number_id: '9876543210123' },
                messages: [{
                  from: '919876543210',
                  id: `wamid.unsigned_${Date.now()}`,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  text: { body: 'Unsigned request must never be processed' },
                  type: 'text',
                }],
              },
              field: 'messages',
            }],
          }],
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_REQUIRED');
    });


  });

  describe('5. Outbound Messages & Templates', () => {
    it('blocks sending without explicit consent and outside the 24-hour window, then deduplicates a valid send', async () => {
      await configureTestWhatsApp();
      const { lead, phone, phoneDigits } = await createTestLead();
      try {
        const noConsentSend = await request(app)
          .post('/api/whatsapp/messages')
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({
            recipientPhone: phone,
            body: 'Must not send without consent',
            leadId: lead.id,
            idempotencyKey: `consent-block-${lead.id}`,
          });
        expect(noConsentSend.status).toBe(403);
        expect(noConsentSend.body.error.code).toBe('WHATSAPP_CONSENT_REQUIRED');

        const consent = await request(app)
          .patch(`/api/leads/${lead.id}/consent`)
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({ consentStatus: 'Consented', consentSource: 'website_form' });
        expect(consent.status).toBe(200);
        expect(consent.body.data.consentRecordedAt).toBeTruthy();

        const closedWindowSend = await request(app)
          .post('/api/whatsapp/messages')
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({
            recipientPhone: phone,
            body: 'Must not send outside the customer-service window',
            leadId: lead.id,
            idempotencyKey: `window-block-${lead.id}`,
          });
        expect(closedWindowSend.status).toBe(409);
        expect(closedWindowSend.body.error.code).toBe('WHATSAPP_TEMPLATE_REQUIRED');

        const inboundPayload = {
          object: 'whatsapp_business_account',
          entry: [{
            id: '209384756192834',
            changes: [{
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '919999988888', phone_number_id: '9876543210123' },
                messages: [{
                  from: phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits,
                  id: `wamid.inbound_${lead.id}`,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  text: { body: 'Can you tell me more about the service?' },
                  type: 'text',
                }],
              },
              field: 'messages',
            }],
          }],
        };
        const inbound = await request(app)
          .post('/api/whatsapp/webhook')
          .set('x-hub-signature-256', signWebhook(inboundPayload))
          .set('x-tenant-id', 'forged-tenant-header-is-ignored')
          .send(inboundPayload);
        expect(inbound.status).toBe(200);
        expect(inbound.body.processed).toBe(1);

        const body = {
          recipientPhone: phone,
          body: 'Hello from OneClick CRM automated test',
          leadId: lead.id,
          idempotencyKey: `send-once-${lead.id}`,
        };
        const first = await request(app)
          .post('/api/whatsapp/messages')
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send(body);
        expect(first.status).toBe(201);
        expect(first.body.success).toBe(true);
        expect(first.body.data.direction).toBe('outbound');
        expect(first.body.data.status).toBe('sent');
        expect(first.body.data.providerMessageId).toBeTruthy();

        const replay = await request(app)
          .post('/api/whatsapp/messages')
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send(body);
        expect(replay.status).toBe(200);
        expect(replay.body.meta.idempotentReplay).toBe(true);
        expect(replay.body.data.providerMessageId).toBe(first.body.data.providerMessageId);

        const statusPayload = {
          object: 'whatsapp_business_account',
          entry: [{
            id: '209384756192834',
            changes: [{
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '919999988888', phone_number_id: '9876543210123' },
                statuses: [{
                  id: first.body.data.providerMessageId,
                  status: 'delivered',
                  recipient_id: phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                }],
              },
              field: 'messages',
            }],
          }],
        };
        const delivery = await request(app)
          .post('/api/whatsapp/webhook')
          .set('x-hub-signature-256', signWebhook(statusPayload))
          .send(statusPayload);
        expect(delivery.status).toBe(200);
        expect(delivery.body.processed).toBe(1);

        const stored = await pool.query(
          `SELECT direction, status FROM whatsapp_messages WHERE tenant_id = $1 AND provider_message_id = $2`,
          [DEFAULT_TENANT_ID, first.body.data.providerMessageId],
        );
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0].direction).toBe('outbound');
        expect(stored.rows[0].status).toBe('delivered');

        const threads = await request(app)
          .get(`/api/whatsapp/messages?leadId=${encodeURIComponent(lead.id)}`)
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite');
        expect(threads.status).toBe(200);
        expect(threads.body.data.some((message: any) => message.direction === 'inbound' && message.body === 'Can you tell me more about the service?')).toBe(true);
        expect(threads.body.data.some((message: any) => message.direction === 'inbound' && message.body === '')).toBe(false);

        const optedOut = await request(app)
          .patch(`/api/leads/${lead.id}/consent`)
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({ consentStatus: 'Opted Out' });
        expect(optedOut.status).toBe(200);
        expect(optedOut.body.data.optedOutAt).toBeTruthy();

        // Switching the label back to Unknown must not silently clear a prior opt-out.
        const resetToUnknown = await request(app)
          .patch(`/api/leads/${lead.id}/consent`)
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({ consentStatus: 'Unknown' });
        expect(resetToUnknown.status).toBe(200);
        expect(resetToUnknown.body.data.optedOutAt).toBeTruthy();

        const afterOptOut = await request(app)
          .post('/api/whatsapp/messages')
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({
            recipientPhone: phone,
            body: 'Must not send after opt-out or while consent is unknown',
            leadId: lead.id,
            idempotencyKey: `optout-block-${lead.id}`,
          });
        expect(afterOptOut.status).toBe(403);
        expect(afterOptOut.body.error.code).toBe('WHATSAPP_CONSENT_REQUIRED');

        // Only a fresh, explicit consent update may clear the recorded opt-out.
        const renewedConsent = await request(app)
          .patch(`/api/leads/${lead.id}/consent`)
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({ consentStatus: 'Consented', consentSource: 'website_form' });
        expect(renewedConsent.status).toBe(200);
        expect(renewedConsent.body.data.optedOutAt).toBeNull();

        const afterRenewedConsent = await request(app)
          .post('/api/whatsapp/messages')
          .set('Authorization', `Bearer ${rohanToken}`)
          .set('x-tenant-id', 'tenant_bring_my_bite')
          .send({
            recipientPhone: phone,
            body: 'Test message after explicit renewed consent',
            leadId: lead.id,
            idempotencyKey: `renewed-consent-${lead.id}`,
          });
        expect(afterRenewedConsent.status).toBe(201);
        expect(afterRenewedConsent.body.data.direction).toBe('outbound');
      } finally {
        await cleanupTestLead(lead.id, phone);
      }
    });

    it('returns only approved local template fixtures in test mode', async () => {
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
