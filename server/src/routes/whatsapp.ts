import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';
import { DEFAULT_TENANT_ID } from '../db/seed';
import {
  getWhatsAppAdapter,
  getAllSupportedWhatsAppProviders,
  maskCredentials,
  encryptSecret,
  decryptSecret,
} from '../services/whatsapp/adapterRegistry';
import { WhatsAppCredentials, WhatsAppTemplate } from '../services/whatsapp/types';

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

// In-memory store for fallback & test execution
const IN_MEMORY_SETTINGS: Record<string, any> = process.env.NODE_ENV === 'test' ? {
  tenant_bring_my_bite: {
    provider: 'cloud_api',
    phoneNumberId: '109823475689123',
    businessAccountId: '209384756192834',
    accessToken: 'test_token_bring_my_bite_987654',
    appSecret: 'test_secret_bring_my_bite_123456',
    webhookVerifyToken: 'oneclick_verify_token_bring_my_bite',
    status: 'connected',
    lastTestedAt: new Date().toISOString(),
  },
} : {};

const IN_MEMORY_MESSAGES: any[] = process.env.NODE_ENV === 'test' ? [
  {
    id: 'w-msg-1',
    tenantId: 'tenant_bring_my_bite',
    leadId: 'l-1',
    senderPhone: '+919876543219',
    recipientPhone: '+919999988888',
    direction: 'inbound',
    messageType: 'text',
    body: 'Can you send over the pricing for the team inbox plan?',
    status: 'read',
    aiGenerated: false,
    createdAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  },
  {
    id: 'w-msg-2',
    tenantId: 'tenant_bring_my_bite',
    leadId: 'l-1',
    senderPhone: '+919999988888',
    recipientPhone: '+919876543219',
    direction: 'outbound',
    messageType: 'text',
    body: 'Hi Neha! Thanks for reaching out. We have Starter and Growth tiers. Would you like a brochure?',
    status: 'delivered',
    aiGenerated: false,
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
] : [];

const PREDEFINED_TEMPLATES: WhatsAppTemplate[] = [
  {
    name: 'welcome_lead_intro',
    language: 'en',
    category: 'UTILITY',
    header: 'Welcome to {{company}}',
    body: 'Hello {{name}}, thank you for contacting us! A dedicated relationship manager will reach out shortly.',
    status: 'APPROVED',
  },
  {
    name: 'quote_proposal_ready',
    language: 'en',
    category: 'UTILITY',
    header: 'Proposal Ready',
    body: 'Hi {{name}}, your requested proposal for {{company}} has been prepared. Please reply to review.',
    status: 'APPROVED',
  },
  {
    name: 'followup_reminder_checkin',
    language: 'en',
    category: 'MARKETING',
    header: 'Checking In',
    body: 'Hello {{name}}, checking in to see if you had any questions regarding our earlier conversation.',
    status: 'APPROVED',
  },
];

// 1. GET /api/whatsapp/config - Get current tenant provider configuration (Masked)
router.get('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const rawConfig = IN_MEMORY_SETTINGS[rawTenantId] || { provider: 'mock', status: 'unconfigured' };
    res.json({
      success: true,
      data: {
        config: maskCredentials(rawConfig),
        supportedProviders: getAllSupportedWhatsAppProviders(),
        webhookUrl: `${req.protocol}://${req.get('host')}/api/whatsapp/webhook`,
      },
      meta: { requestId },
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT config_data FROM tenant_settings WHERE tenant_id = $1 AND category = 'whatsapp' LIMIT 1;`,
      [tenantId]
    );

    let rawConfig: any = { provider: 'cloud_api', status: 'unconfigured' };
    if (result.rows.length > 0) {
      rawConfig = result.rows[0].config_data;
      if (rawConfig.accessToken) rawConfig.accessToken = decryptSecret(rawConfig.accessToken);
      if (rawConfig.apiKey) rawConfig.apiKey = decryptSecret(rawConfig.apiKey);
      if (rawConfig.appSecret) rawConfig.appSecret = decryptSecret(rawConfig.appSecret);
    }

    res.json({
      success: true,
      data: {
        config: maskCredentials(rawConfig),
        supportedProviders: getAllSupportedWhatsAppProviders(),
        webhookUrl: `${req.protocol}://${req.get('host')}/api/whatsapp/webhook`,
      },
      meta: { requestId },
    });
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

// 2. POST /api/whatsapp/config - Save & test credentials for tenant
router.post('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { provider = 'cloud_api', phoneNumberId, businessAccountId, accessToken, appSecret, webhookVerifyToken, apiKey, sourceNumber } = req.body;

  const credentials: WhatsAppCredentials = {
    provider,
    phoneNumberId,
    businessAccountId,
    accessToken,
    appSecret,
    webhookVerifyToken,
    apiKey,
    sourceNumber,
  };

  const adapter = getWhatsAppAdapter(provider);
  const validation = await adapter.validateCredentials(credentials);

  const status = validation.valid ? 'connected' : 'error';
  const errorMessage = validation.error;
  const lastTestedAt = new Date().toISOString();

  const configToStore: any = {
    ...credentials,
    status,
    errorMessage,
    lastTestedAt,
  };

  const dbConfig = resolveDatabaseConfig();
  if (dbConfig.isBlocked) {
    IN_MEMORY_SETTINGS[rawTenantId] = configToStore;
    res.json({
      success: true,
      data: {
        config: maskCredentials(configToStore),
        validation,
      },
      meta: { requestId },
    });
    return;
  }

  try {
    // Encrypt sensitive secrets before persisting to PostgreSQL
    const encryptedConfig = {
      ...configToStore,
      accessToken: accessToken ? encryptSecret(accessToken) : undefined,
      appSecret: appSecret ? encryptSecret(appSecret) : undefined,
      apiKey: apiKey ? encryptSecret(apiKey) : undefined,
    };

    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, category, config_data, updated_at)
       VALUES ($1, 'whatsapp', $2, NOW())
       ON CONFLICT (tenant_id, category)
       DO UPDATE SET config_data = $2, updated_at = NOW();`,
      [tenantId, JSON.stringify(encryptedConfig)]
    );

    res.json({
      success: true,
      data: {
        config: maskCredentials(configToStore),
        validation,
      },
      meta: { requestId },
    });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({ success: false, error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: error.message, requestId } });
  }
});

// 3. GET /api/whatsapp/webhook - Verify Meta's configured challenge token.
router.get('/webhook', (req: Request, res: Response): void => {
  const requestId = req.requestId || 'req_unknown';
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!expectedToken) {
    res.status(503).json({ success: false, error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'WhatsApp webhook verification is not configured.', requestId } });
    return;
  }
  if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') {
    res.status(403).json({ success: false, error: { code: 'WEBHOOK_VERIFICATION_FAILED', message: 'WhatsApp webhook verification failed.', requestId } });
    return;
  }
  const provided = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.status(403).json({ success: false, error: { code: 'WEBHOOK_VERIFICATION_FAILED', message: 'WhatsApp webhook verification failed.', requestId } });
    return;
  }
  res.status(200).send(challenge);
});

// 4. POST /api/whatsapp/webhook - Verify HMAC before processing events.
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const providedSignature = req.headers['x-hub-signature-256'];
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!appSecret) {
    res.status(503).json({ success: false, error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'WhatsApp webhook signature verification is not configured.', requestId } });
    return;
  }
  if (!rawBody || typeof providedSignature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(providedSignature)) {
    res.status(401).json({ success: false, error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'WhatsApp webhook signature is missing or invalid.', requestId } });
    return;
  }
  const expectedSignature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    res.status(401).json({ success: false, error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'WhatsApp webhook signature verification failed.', requestId } });
    return;
  }

  const adapter = getWhatsAppAdapter('cloud_api');
  const events = adapter.parseWebhookEvent(req.body);
  if (events.length === 0) {
    res.status(200).json({ success: true, processed: 0 });
    return;
  }

  const entryItems = Array.isArray(req.body?.entry) ? req.body.entry : [];
  const phoneNumberIds = new Set<string>();
  for (const entry of entryItems) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const phoneId = change?.value?.metadata?.phone_number_id;
      if (typeof phoneId === 'string' && phoneId.trim()) phoneNumberIds.add(phoneId.trim());
    }
  }
  if (phoneNumberIds.size !== 1) {
    res.status(400).json({ success: false, error: { code: 'WEBHOOK_TENANT_AMBIGUOUS', message: 'Webhook payload must identify exactly one configured WhatsApp phone number.', requestId } });
    return;
  }
  const phoneNumberId = [...phoneNumberIds][0];
  const dbConfig = resolveDatabaseConfig();
  let targetTenantId: string;
  let tenantId: string;

  if (dbConfig.isBlocked && process.env.NODE_ENV === 'test') {
    const testTenantHeader = req.headers['x-tenant-id'];
    if (typeof testTenantHeader !== 'string' || !testTenantHeader.trim()) {
      res.status(403).json({ success: false, error: { code: 'WEBHOOK_TENANT_UNRESOLVED', message: 'Test webhook tenant is required.', requestId } });
      return;
    }
    targetTenantId = testTenantHeader.trim();
    tenantId = toDbTenantId(targetTenantId);
  } else {
    try {
      const configured = await pool.query<{ tenant_id: string }>(
        `SELECT tenant_id::text AS tenant_id
           FROM tenant_settings
          WHERE category = 'whatsapp'
            AND config_data->>'phoneNumberId' = $1
          LIMIT 1`,
        [phoneNumberId]
      );
      if (!configured.rows[0]) {
        res.status(404).json({ success: false, error: { code: 'WHATSAPP_NUMBER_NOT_CONFIGURED', message: 'No workspace is configured for this WhatsApp phone number.', requestId } });
        return;
      }
      tenantId = configured.rows[0].tenant_id;
      targetTenantId = tenantId;
    } catch {
      res.status(503).json({ success: false, error: { code: 'WEBHOOK_DATABASE_UNAVAILABLE', message: 'Webhook storage is temporarily unavailable; retry delivery.', requestId } });
      return;
    }
  }

  let processed = 0;
  for (const event of events) {
    if (dbConfig.isBlocked && process.env.NODE_ENV === 'test') {
      const duplicate = IN_MEMORY_MESSAGES.find(m => m.providerMessageId === event.providerMessageId);
      if (!duplicate && event.body) {
        IN_MEMORY_MESSAGES.push({
          id: `w-msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId: targetTenantId,
          senderPhone: event.senderPhone,
          recipientPhone: event.recipientPhone,
          direction: 'inbound',
          messageType: event.messageType,
          body: event.body,
          status: 'received',
          idempotencyKey: event.providerMessageId,
          providerMessageId: event.providerMessageId,
          aiGenerated: false,
          createdAt: event.timestamp.toISOString(),
        });
        processed += 1;
      }
      continue;
    }

    try {
      const result = await pool.query(
        `INSERT INTO whatsapp_messages (
           tenant_id, sender_phone, recipient_phone, direction, message_type, body, status,
           idempotency_key, provider_message_id, created_at
         ) VALUES ($1, $2, $3, 'inbound', $4, $5, 'received', $6, $6, $7)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;`,
        [
          tenantId,
          event.senderPhone,
          event.recipientPhone,
          event.messageType,
          event.body || '',
          event.providerMessageId,
          event.timestamp,
        ]
      );
      processed += result.rowCount || 0;
    } catch {
      // Return a retryable failure; Meta must be allowed to redeliver after storage recovers.
      res.status(503).json({
        success: false,
        error: {
          code: 'WEBHOOK_PERSISTENCE_FAILED',
          message: 'Webhook event could not be persisted. The provider should retry delivery.',
          requestId,
        },
      });
      return;
    }
  }

  res.status(200).json({ success: true, processed });
});

// 5. GET /api/whatsapp/messages - Fetch Conversation Messages & Threads
router.get('/messages', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { phone, leadId } = req.query;
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    let filtered = IN_MEMORY_MESSAGES.filter(m => m.tenantId === rawTenantId || m.tenantId === tenantId);
    if (phone && typeof phone === 'string') {
      filtered = filtered.filter(m => m.senderPhone === phone || m.recipientPhone === phone);
    }
    res.json({ success: true, data: filtered, meta: { totalCount: filtered.length, requestId } });
    return;
  }

  try {
    const params: any[] = [tenantId];
    let whereSql = 'tenant_id = $1';

    if (phone && typeof phone === 'string') {
      params.push(phone);
      whereSql += ` AND (sender_phone = $${params.length} OR recipient_phone = $${params.length})`;
    }

    if (leadId && typeof leadId === 'string') {
      params.push(leadId);
      whereSql += ` AND lead_id::text = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT 
         id, tenant_id as "tenantId", lead_id as "leadId", contact_id as "contactId",
         direction, sender_phone as "senderPhone", recipient_phone as "recipientPhone",
         message_type as "messageType", body, status, provider_message_id as "providerMessageId",
         ai_generated as "aiGenerated", created_at as "createdAt"
       FROM whatsapp_messages
       WHERE ${whereSql}
       ORDER BY created_at ASC
       LIMIT 100;`,
      params
    );

    res.json({ success: true, data: result.rows, meta: { totalCount: result.rows.length, requestId } });
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

// 6. POST /api/whatsapp/messages - Consent-checked outbound messaging.
router.post('/messages', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { recipientPhone, body, templateName, templateParameters, leadId, idempotencyKey } = req.body || {};
  const dbConfig = resolveDatabaseConfig();
  const testRuntime = process.env.NODE_ENV === 'test';

  if (typeof recipientPhone !== 'string' || !recipientPhone.trim()) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Recipient phone number is required.', requestId } });
    return;
  }
  if ((!body || typeof body !== 'string' || !body.trim()) && (typeof templateName !== 'string' || !templateName.trim())) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Message body or approved template name is required.', requestId } });
    return;
  }
  if (typeof leadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
    res.status(400).json({ success: false, error: { code: 'CONSENT_RECORD_REQUIRED', message: 'Select a persisted lead with a verifiable messaging-consent record before sending WhatsApp messages.', requestId } });
    return;
  }
  const approvedTemplate = templateName
    ? PREDEFINED_TEMPLATES.find((template) => template.name === templateName && template.status === 'APPROVED')
    : undefined;
  if (templateName && !approvedTemplate) {
    res.status(400).json({ success: false, error: { code: 'TEMPLATE_NOT_APPROVED', message: 'Only approved WhatsApp templates may be sent outside the customer-service window.', requestId } });
    return;
  }

  // Resolve consent from the tenant-owned lead. A blocked database is accepted only by
  // the isolated test fixture, and only the dedicated test lead can exercise mock sending.
  if (dbConfig.isBlocked && testRuntime) {
    if (leadId !== 'c0000000-0000-0000-0000-000000000001') {
      res.status(403).json({ success: false, error: { code: 'CONSENT_RECORD_REQUIRED', message: 'The isolated messaging fixture does not recognize this consent record.', requestId } });
      return;
    }
  } else {
    let lead: { phone_normalized: string; consent_status: string; opted_out_at: Date | null } | undefined;
    try {
      const result = await pool.query<{ phone_normalized: string; consent_status: string; opted_out_at: Date | null }>(
        `SELECT phone_normalized, consent_status, opted_out_at
           FROM leads
          WHERE id = $1::uuid AND tenant_id = $2::uuid AND archived_at IS NULL
          LIMIT 1`,
        [leadId, tenantId]
      );
      lead = result.rows[0];
    } catch {
      res.status(503).json({ success: false, error: { code: 'CONSENT_VERIFICATION_UNAVAILABLE', message: 'Messaging consent could not be verified. No message was sent.', requestId } });
      return;
    }
    if (!lead) {
      res.status(404).json({ success: false, error: { code: 'LEAD_NOT_FOUND', message: 'The selected lead was not found in this workspace.', requestId } });
      return;
    }
    const consent = String(lead.consent_status || '').trim().toLowerCase().replace(/[ _-]/g, '');
    if (lead.opted_out_at || !['consented', 'optedin', 'granted'].includes(consent)) {
      res.status(403).json({ success: false, error: { code: 'WHATSAPP_CONSENT_REQUIRED', message: 'This lead has not granted active WhatsApp messaging consent or has opted out.', requestId } });
      return;
    }
    const digits = recipientPhone.replace(/\D/g, '');
    const leadDigits = String(lead.phone_normalized || '').replace(/\D/g, '');
    if (!digits || digits !== leadDigits) {
      res.status(400).json({ success: false, error: { code: 'RECIPIENT_MISMATCH', message: 'The recipient number must match the selected lead’s verified contact number.', requestId } });
      return;
    }

    // Meta permits free-form text only within the 24-hour customer-service window.
    // Outside that window, require a template whose approval is verified by the provider.
    if (body && !templateName && !testRuntime) {
      let inWindow = false;
      try {
        const inbound = await pool.query(
          `SELECT 1 FROM whatsapp_messages
            WHERE tenant_id = $1::uuid
              AND direction = 'inbound'
              AND sender_phone = $2
              AND created_at >= NOW() - INTERVAL '24 hours'
            ORDER BY created_at DESC
            LIMIT 1`,
          [tenantId, lead.phone_normalized]
        );
        inWindow = inbound.rows.length > 0;
      } catch {
        res.status(503).json({ success: false, error: { code: 'MESSAGING_WINDOW_UNAVAILABLE', message: 'The WhatsApp messaging window could not be verified. No message was sent.', requestId } });
        return;
      }
      if (!inWindow) {
        res.status(400).json({ success: false, error: { code: 'APPROVED_TEMPLATE_REQUIRED', message: 'Free-form WhatsApp messages are allowed only within 24 hours of the customer’s last inbound message. Use an approved template instead.', requestId } });
        return;
      }
    }
  }

  let rawConfig: any;
  if (dbConfig.isBlocked && testRuntime) {
    rawConfig = IN_MEMORY_SETTINGS[rawTenantId];
  } else {
    try {
      const result = await pool.query<{ config_data: any }>(
        `SELECT config_data FROM tenant_settings WHERE tenant_id = $1::uuid AND category = 'whatsapp' LIMIT 1`,
        [tenantId]
      );
      rawConfig = result.rows[0]?.config_data;
      if (rawConfig?.accessToken) rawConfig.accessToken = decryptSecret(rawConfig.accessToken);
      if (rawConfig?.apiKey) rawConfig.apiKey = decryptSecret(rawConfig.apiKey);
      if (rawConfig?.appSecret) rawConfig.appSecret = decryptSecret(rawConfig.appSecret);
    } catch {
      res.status(503).json({ success: false, error: { code: 'WHATSAPP_CONFIG_UNAVAILABLE', message: 'WhatsApp configuration could not be loaded. No message was sent.', requestId } });
      return;
    }
  }
  if (!rawConfig) {
    res.status(409).json({ success: false, error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'Configure a real WhatsApp provider before sending messages.', requestId } });
    return;
  }

  if (!testRuntime && (rawConfig.status !== 'connected' || rawConfig.provider === 'mock')) {
    res.status(409).json({ success: false, error: { code: 'WHATSAPP_NOT_CONNECTED', message: 'The WhatsApp provider has not passed live credential validation. No message was sent.', requestId } });
    return;
  }
  if (testRuntime && !['test_mode', 'connected'].includes(rawConfig.status)) {
    res.status(409).json({ success: false, error: { code: 'WHATSAPP_TEST_CONFIG_INVALID', message: 'The isolated test configuration is not ready for mock messaging.', requestId } });
    return;
  }

  // All automated tests are wired to the mock provider. Test credentials can never cause
  // outbound requests to Meta/Gupshup. Only non-test runtime uses the validated provider.
  const effectiveConfig = testRuntime
    ? { provider: 'mock', phoneNumberId: rawConfig.phoneNumberId || 'test-phone-number' }
    : rawConfig;
  const adapter = getWhatsAppAdapter(effectiveConfig.provider);
  const sendResult = await adapter.sendMessage({
    tenantId,
    recipientPhone: recipientPhone.trim(),
    messageType: templateName ? 'template' : 'text',
    body: typeof body === 'string' ? body.trim() : `Template: ${templateName}`,
    templateName,
    templateParameters,
    idempotencyKey,
    leadId,
    credentials: effectiveConfig,
  });

  if (!sendResult.success) {
    res.status(502).json({ success: false, error: { code: 'PROVIDER_ERROR', message: sendResult.error || 'Provider rejected the message.', requestId } });
    return;
  }

  const senderDigits = String(effectiveConfig.phoneNumberId || effectiveConfig.sourceNumber || '').replace(/\D/g, '');
  const newMsg = {
    tenantId: rawTenantId,
    leadId,
    senderPhone: senderDigits ? `+${senderDigits}` : '',
    recipientPhone: recipientPhone.trim(),
    direction: 'outbound',
    messageType: templateName ? 'template' : 'text',
    body: typeof body === 'string' ? body.trim() : `[Template: ${templateName}]`,
    status: sendResult.status,
    providerMessageId: sendResult.providerMessageId,
    idempotencyKey: idempotencyKey || undefined,
    aiGenerated: false,
    createdAt: new Date().toISOString(),
  };

  if (dbConfig.isBlocked && testRuntime) {
    const testMessage = { ...newMsg, id: `w-msg-test-${Date.now()}` };
    IN_MEMORY_MESSAGES.push(testMessage);
    res.status(201).json({ success: true, data: testMessage, meta: { requestId } });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO whatsapp_messages (
         tenant_id, lead_id, sender_phone, recipient_phone, direction, message_type,
         body, status, idempotency_key, provider_message_id, created_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4, 'outbound', $5, $6, $7, $8, $9, NOW())
       RETURNING id, tenant_id as "tenantId", lead_id as "leadId", direction,
                 sender_phone as "senderPhone", recipient_phone as "recipientPhone",
                 message_type as "messageType", body, status, provider_message_id as "providerMessageId",
                 created_at as "createdAt";`,
      [tenantId, leadId, newMsg.senderPhone, newMsg.recipientPhone, newMsg.messageType, newMsg.body, newMsg.status, idempotencyKey || null, sendResult.providerMessageId]
    );
    res.status(201).json({ success: true, data: result.rows[0], meta: { requestId } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'WHATSAPP_PERSISTENCE_FAILED', message: 'The provider accepted the message but CRM persistence could not be confirmed. Check provider status before retrying.', requestId } });
  }
});

// 7. GET /api/whatsapp/templates - Predefined & Approved Templates
router.get('/templates', requireAuth, requireTenant(), (req: Request, res: Response) => {
  res.json({
    success: true,
    data: PREDEFINED_TEMPLATES,
    meta: { totalCount: PREDEFINED_TEMPLATES.length, requestId: req.requestId },
  });
});

export default router;
