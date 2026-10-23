import { Router, Request, Response } from 'express';
import { getMetaPhoneNumberId, secureTokenEquals, verifyMetaWebhookSignature } from '../services/whatsapp/webhookSecurity';
import { getMetaGraphApiVersion } from '../services/whatsapp/cloudApiAdapter';
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
import { reserveMonthlyUsage, releaseMonthlyUsage, PlanQuotaExceededError, SubscriptionAccessError } from '../services/billing/usageMetering';

const router = Router();

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

function sendWhatsAppUnavailable(res: Response, requestId: string, code: string, message: string): void {
  res.status(503).json({ success: false, error: { code, message, requestId } });
}

async function loadTenantWhatsAppConfig(tenantId: string): Promise<any | null> {
  const result = await pool.query(
    `SELECT config_data
     FROM tenant_settings
     WHERE tenant_id = $1 AND category = 'whatsapp'
     LIMIT 1;`,
    [tenantId],
  );
  if (!result.rows.length) return null;
  const stored = typeof result.rows[0].config_data === 'string'
    ? JSON.parse(result.rows[0].config_data)
    : result.rows[0].config_data;
  const config = { ...stored };
  for (const key of ['accessToken', 'appSecret', 'webhookVerifyToken', 'apiKey', 'authToken']) {
    if (typeof config[key] === 'string' && config[key]) config[key] = decryptSecret(config[key]);
  }
  return config;
}

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
const IN_MEMORY_SETTINGS: Record<string, any> = {
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
};

const IN_MEMORY_MESSAGES: any[] = [
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
];

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

// 1. GET /api/whatsapp/config - Read the persisted workspace provider configuration.
router.get('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    if (!isTestRuntime()) {
      sendWhatsAppUnavailable(res, requestId, 'DATABASE_CONFIGURATION_INVALID', 'WhatsApp configuration cannot be loaded because the database configuration is invalid.');
      return;
    }
    const rawConfig = IN_MEMORY_SETTINGS[req.tenantContext!.tenantId] || { provider: 'cloud_api', status: 'unconfigured' };
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
    const rawConfig = await loadTenantWhatsAppConfig(tenantId) || { provider: 'cloud_api', status: 'unconfigured' };
    res.json({
      success: true,
      data: {
        config: maskCredentials(rawConfig),
        supportedProviders: getAllSupportedWhatsAppProviders(),
        webhookUrl: `${req.protocol}://${req.get('host')}/api/whatsapp/webhook`,
      },
      meta: { requestId },
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[WhatsApp Config] Read failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_CONFIG_UNAVAILABLE', 'Saved WhatsApp configuration could not be loaded.');
  }
});

// 2. POST /api/whatsapp/config - Verify provider credentials, then persist encrypted settings.
router.post('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const requestId = req.requestId || 'req_unknown';
  const body = req.body || {};
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    sendWhatsAppUnavailable(res, requestId, 'DATABASE_CONFIGURATION_INVALID', 'WhatsApp configuration cannot be saved until the database is configured.');
    return;
  }

  let existing: any = null;
  try {
    existing = await loadTenantWhatsAppConfig(tenantId);
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[WhatsApp Config] Existing configuration could not be loaded', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_CONFIG_UNAVAILABLE', 'Existing WhatsApp settings could not be loaded safely.');
    return;
  }

  const provider = typeof body.provider === 'string' && body.provider ? body.provider : existing?.provider || 'cloud_api';
  let adapter;
  try {
    adapter = getWhatsAppAdapter(provider as any);
  } catch {
    res.status(400).json({
      success: false,
      error: { code: 'WHATSAPP_PROVIDER_UNSUPPORTED', message: 'This WhatsApp provider is not implemented in the current release.', requestId },
    });
    return;
  }

  const keepOrReplace = (next: unknown, previous: unknown): string | undefined => {
    if (typeof next === 'string' && next.trim()) return next.trim();
    return typeof previous === 'string' && previous ? previous : undefined;
  };

  const credentials: WhatsAppCredentials = {
    provider: provider as any,
    phoneNumberId: keepOrReplace(body.phoneNumberId, existing?.phoneNumberId),
    businessAccountId: keepOrReplace(body.businessAccountId, existing?.businessAccountId),
    accessToken: keepOrReplace(body.accessToken, existing?.accessToken),
    appSecret: keepOrReplace(body.appSecret, existing?.appSecret),
    webhookVerifyToken: keepOrReplace(body.webhookVerifyToken, existing?.webhookVerifyToken),
    apiKey: keepOrReplace(body.apiKey, existing?.apiKey),
    sourceNumber: keepOrReplace(body.sourceNumber, existing?.sourceNumber),
  };

  const validation = await adapter.validateCredentials(credentials);
  if (!validation.valid) {
    res.status(400).json({
      success: false,
      error: { code: 'WHATSAPP_CREDENTIALS_INVALID', message: validation.error || 'Provider credentials could not be verified.', requestId },
      data: { validation: { valid: false } },
    });
    return;
  }

  const configToStore: any = {
    ...credentials,
    status: 'connected',
    errorMessage: undefined,
    lastTestedAt: new Date().toISOString(),
  };
  const encryptedConfig = {
    ...configToStore,
    accessToken: credentials.accessToken ? encryptSecret(credentials.accessToken) : undefined,
    appSecret: credentials.appSecret ? encryptSecret(credentials.appSecret) : undefined,
    webhookVerifyToken: credentials.webhookVerifyToken ? encryptSecret(credentials.webhookVerifyToken) : undefined,
    apiKey: credentials.apiKey ? encryptSecret(credentials.apiKey) : undefined,
    authToken: credentials.authToken ? encryptSecret(credentials.authToken) : undefined,
  };

  try {
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, category, config_data, updated_at)
       VALUES ($1, 'whatsapp', $2, NOW())
       ON CONFLICT (tenant_id, category)
       DO UPDATE SET config_data = $2, updated_at = NOW();`,
      [tenantId, JSON.stringify(encryptedConfig)],
    );

    res.json({
      success: true,
      data: {
        config: maskCredentials(configToStore),
        validation: { valid: true },
      },
      meta: { requestId },
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
      : 'DATABASE_ERROR';
    console.error('[WhatsApp Config] Save failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_CONFIG_SAVE_FAILED', 'WhatsApp configuration could not be saved.');
  }
});

// 3. GET /api/whatsapp/webhook - Verify Meta challenge against a persisted workspace secret.
router.get('/webhook', async (req: Request, res: Response): Promise<void> => {
  const mode = req.query['hub.mode'];
  const suppliedToken = typeof req.query['hub.verify_token'] === 'string'
    ? req.query['hub.verify_token']
    : undefined;
  const challenge = typeof req.query['hub.challenge'] === 'string'
    ? req.query['hub.challenge']
    : undefined;
  const requestId = req.requestId || 'req_unknown';

  if (mode !== 'subscribe' || !suppliedToken || !challenge) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_WEBHOOK_CHALLENGE', message: 'Meta webhook verification parameters are incomplete.', requestId },
    });
    return;
  }

  try {
    const result = await pool.query<{ config_data: any }>(
      `SELECT config_data
       FROM tenant_settings
       WHERE category = 'whatsapp'
       ORDER BY updated_at DESC
       LIMIT 100;`,
    );

    const verified = result.rows.some((row) => {
      const config = typeof row.config_data === 'string' ? JSON.parse(row.config_data) : row.config_data;
      const storedToken = config?.webhookVerifyToken
        ? decryptSecret(String(config.webhookVerifyToken))
        : '';
      return secureTokenEquals(storedToken, suppliedToken);
    });

    if (!verified) {
      res.status(403).json({
        success: false,
        error: { code: 'WEBHOOK_VERIFICATION_DENIED', message: 'The supplied webhook verification token does not match a configured workspace.', requestId },
      });
      return;
    }

    res.status(200).type('text/plain').send(challenge);
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[WhatsApp Webhook] Challenge verification failed', { requestId, errorCode });
    res.status(503).json({
      success: false,
      error: { code: 'WEBHOOK_VERIFICATION_UNAVAILABLE', message: 'Webhook verification is unavailable until the database is healthy.', requestId },
    });
  }
});

// 4. POST /api/whatsapp/webhook - Verify provider signature before processing events.
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = typeof req.headers['x-hub-signature-256'] === 'string'
    ? req.headers['x-hub-signature-256']
    : undefined;
  const phoneNumberId = getMetaPhoneNumberId(req.body);

  if (!rawBody || !signature || !phoneNumberId) {
    res.status(401).json({
      success: false,
      error: { code: 'WEBHOOK_SIGNATURE_REQUIRED', message: 'A valid signed Meta webhook with one configured phone-number ID is required.', requestId },
    });
    return;
  }

  let matchedTenantId: string | null = null;
  let appSecret: string | null = null;
  try {
    const result = await pool.query<{ tenant_id: string; config_data: any }>(
      `SELECT tenant_id, config_data
       FROM tenant_settings
       WHERE category = 'whatsapp'
         AND config_data->>'phoneNumberId' = $1
       LIMIT 2;`,
      [phoneNumberId],
    );
    // Reject ambiguous phone-number mappings rather than selecting an arbitrary tenant.
    if (result.rows.length !== 1) {
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_WORKSPACE_NOT_CONFIGURED', message: 'No unique workspace configuration matches this Meta phone number.', requestId },
      });
      return;
    }

    const row = result.rows[0];
    const config = typeof row.config_data === 'string' ? JSON.parse(row.config_data) : row.config_data;
    appSecret = config?.appSecret ? decryptSecret(String(config.appSecret)) : null;
    if (!appSecret || !verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The Meta webhook signature is missing or invalid.', requestId },
      });
      return;
    }
    matchedTenantId = row.tenant_id;
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[WhatsApp Webhook] Signature verification failed', { requestId, errorCode });
    res.status(503).json({
      success: false,
      error: { code: 'WEBHOOK_VERIFICATION_UNAVAILABLE', message: 'Webhook verification is unavailable until the database is healthy.', requestId },
    });
    return;
  }

  const adapter = getWhatsAppAdapter('cloud_api');
  const events = adapter.parseWebhookEvent(req.body);
  if (events.length === 0) {
    res.status(200).json({ success: true, processed: 0, requestId });
    return;
  }

  // Resolve the tenant exclusively from the credential that passed HMAC verification;
  // never use a caller-controlled x-tenant-id header for webhook ownership.
  const tenantId = toDbTenantId(matchedTenantId!);
  let processed = 0;

  for (const event of events) {
    try {
      await pool.query(
        `INSERT INTO whatsapp_messages (
           tenant_id, sender_phone, recipient_phone, direction, message_type, body, status, provider_message_id, idempotency_key, created_at
         ) VALUES ($1, $2, $3, 'inbound', $4, $5, 'received', $6, $6, $7)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;`,
        [tenantId, event.senderPhone, event.recipientPhone, event.messageType, event.body, event.providerMessageId, event.timestamp],
      );
      processed += 1;
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
        : 'DATABASE_ERROR';
      console.error('[WhatsApp Webhook] Message persistence failed', { requestId, errorCode });
      res.status(503).json({
        success: false,
        error: { code: 'WEBHOOK_PERSISTENCE_FAILED', message: 'The webhook event was not fully persisted; retry delivery.', requestId },
      });
      return;
    }
  }

  res.status(200).json({ success: true, processed, requestId });
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
    if (isTestRuntime() && resolveDatabaseConfig().isBlocked) {
      const filtered = IN_MEMORY_MESSAGES.filter(m => m.tenantId === rawTenantId || m.tenantId === tenantId);
      res.json({ success: true, data: filtered, meta: { totalCount: filtered.length, requestId } });
      return;
    }
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
      : 'DATABASE_ERROR';
    console.error('[WhatsApp Messages] Read failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_MESSAGES_UNAVAILABLE', 'WhatsApp messages could not be loaded from persistent storage.');
  }
});

// 6. POST /api/whatsapp/messages - Dispatch Outbound Message
router.post('/messages', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { recipientPhone, body, templateName, templateParameters, leadId, idempotencyKey } = req.body;

  if (!recipientPhone || !recipientPhone.trim()) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Recipient phone number is required.', requestId },
    });
    return;
  }

  if (!body && !templateName) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Message body or template name is required.', requestId },
    });
    return;
  }

  // Public demo outbound is always simulated and is never sent to Meta or another provider.
  if (res.locals.demoMode === true) {
    const simulatedId = `demo-sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const simulatedBody = body || `[Demo template: ${templateName}]`;
    try {
      const result = await pool.query(
        `INSERT INTO whatsapp_messages (
           tenant_id, lead_id, sender_phone, recipient_phone, direction, message_type,
           body, status, idempotency_key, provider_message_id, created_at
         ) VALUES ($1, $2, '+910000000000', $3, 'outbound', $4, $5, 'simulated', $6, $7, NOW())
         RETURNING id, tenant_id as "tenantId", lead_id as "leadId", direction,
                   sender_phone as "senderPhone", recipient_phone as "recipientPhone",
                   message_type as "messageType", body, status, provider_message_id as "providerMessageId",
                   created_at as "createdAt";`,
        [tenantId, leadId || null, recipientPhone.trim(), templateName ? 'template' : 'text',
          simulatedBody, idempotencyKey || simulatedId, simulatedId],
      );
      res.status(201).json({
        success: true,
        data: result.rows[0],
        meta: { requestId, demoMode: true, providerSent: false, notice: 'Demo simulation only. No WhatsApp message was sent.' },
      });
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
        : 'DATABASE_ERROR';
      console.error('[WhatsApp Demo] Could not persist simulated message', { requestId, errorCode });
      sendWhatsAppUnavailable(res, requestId, 'DEMO_MESSAGE_SIMULATION_FAILED', 'The demo message could not be simulated. No external message was sent.');
    }
    return;
  }

  // Outbound messages require a real, persisted workspace configuration.
  let rawConfig: any = null;
  try {
    rawConfig = await loadTenantWhatsAppConfig(tenantId);
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[WhatsApp Messages] Provider configuration lookup failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_CONFIG_UNAVAILABLE', 'Saved provider configuration could not be loaded.');
    return;
  }

  if (!rawConfig || rawConfig.status !== 'connected') {
    res.status(409).json({
      success: false,
      error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'Configure and verify an actual WhatsApp provider before sending messages.', requestId },
    });
    return;
  }

  if (rawConfig.provider === 'mock' && process.env.NODE_ENV === 'production') {
    res.status(409).json({
      success: false,
      error: { code: 'WHATSAPP_MOCK_DISABLED', message: 'The mock provider is disabled in production.', requestId },
    });
    return;
  }

  let adapter;
  try {
    adapter = getWhatsAppAdapter(rawConfig.provider);
  } catch {
    res.status(400).json({
      success: false,
      error: { code: 'WHATSAPP_PROVIDER_UNSUPPORTED', message: 'This WhatsApp provider is not implemented in the current release.', requestId },
    });
    return;
  }

  // Reserve a monthly message before any real provider call.
  let usageReservation;
  try {
    usageReservation = await reserveMonthlyUsage(tenantId, 'messages', 1);
  } catch (error) {
    if (error instanceof PlanQuotaExceededError) {
      res.status(429).json({
        success: false,
        error: {
          code: error.code,
          message: `Your monthly WhatsApp message limit has been reached (${error.used}/${error.limit}). Upgrade your plan to continue.`,
          metric: error.metric,
          used: error.used,
          limit: error.limit,
          requestId,
        },
      });
      return;
    }
    if (error instanceof SubscriptionAccessError) {
      res.status(402).json({
        success: false,
        error: { code: error.code, message: 'This workspace subscription is not active. Update the plan before sending messages.', status: error.subscriptionStatus, requestId },
      });
      return;
    }
    console.error('[WhatsApp Messages] Monthly usage reservation failed', { requestId, error });
    sendWhatsAppUnavailable(res, requestId, 'USAGE_METER_UNAVAILABLE', 'Message quota could not be verified. No outbound message was sent.');
    return;
  }

  // Send message through provider adapter. Release the quota reservation only when
  // the provider definitively reports a failed send; ambiguous timeouts stay counted
  // so retry uncertainty cannot silently exceed the monthly allowance.
  let sendResult;
  try {
    sendResult = await adapter.sendMessage({
      tenantId,
      recipientPhone: recipientPhone.trim(),
      messageType: templateName ? 'template' : 'text',
      body: body || `Template: ${templateName}`,
      templateName,
      templateParameters,
      idempotencyKey,
      leadId,
      credentials: rawConfig,
    });
  } catch (error) {
    console.error('[WhatsApp Messages] Provider call threw after quota reservation', { requestId, error });
    res.status(502).json({
      success: false,
      error: {
        code: 'PROVIDER_RESULT_UNKNOWN',
        message: 'The provider result is unknown. The message quota remains reserved to avoid duplicate delivery and quota bypass.',
        requestId,
      },
    });
    return;
  }

  if (!sendResult.success) {
    await releaseMonthlyUsage(usageReservation).catch((error) => {
      console.error('[WhatsApp Messages] Could not release failed-send reservation', { requestId, error });
    });
    res.status(502).json({
      success: false,
      error: {
        code: 'PROVIDER_ERROR',
        message: sendResult.error || 'Failed to dispatch message to WhatsApp provider.',
        requestId,
      },
    });
    return;
  }

  const newMsg = {
    id: `w-msg-${Date.now()}`,
    tenantId: rawTenantId,
    leadId: leadId || undefined,
    senderPhone: rawConfig.phoneNumberId ? `+${rawConfig.phoneNumberId}` : '+919999988888',
    recipientPhone: recipientPhone.trim(),
    direction: 'outbound',
    messageType: templateName ? 'template' : 'text',
    body: body || `[Template: ${templateName}]`,
    status: sendResult.status,
    providerMessageId: sendResult.providerMessageId,
    idempotencyKey: idempotencyKey || undefined,
    aiGenerated: false,
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await pool.query(
      `INSERT INTO whatsapp_messages (
         tenant_id, lead_id, sender_phone, recipient_phone, direction, message_type,
         body, status, idempotency_key, provider_message_id, created_at
       ) VALUES ($1, $2, $3, $4, 'outbound', $5, $6, $7, $8, $9, NOW())
       RETURNING id, tenant_id as "tenantId", lead_id as "leadId", direction,
                 sender_phone as "senderPhone", recipient_phone as "recipientPhone",
                 message_type as "messageType", body, status, provider_message_id as "providerMessageId",
                 created_at as "createdAt";`,
      [
        tenantId,
        leadId || null,
        newMsg.senderPhone,
        newMsg.recipientPhone,
        newMsg.messageType,
        newMsg.body,
        newMsg.status,
        idempotencyKey || null,
        sendResult.providerMessageId,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0], meta: { requestId } });
  } catch (error: any) {
    if (error.name === 'DatabaseSafetyError') {
      res.status(503).json({ success: false, error: { code: 'DATABASE_SAFETY_BLOCKED', message: error.message, requestId } });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'DATABASE_ERROR', message: error.message, requestId } });
  }
});

// 7. GET /api/whatsapp/templates - Live Meta templates, local samples only in automated tests.
router.get('/templates', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const requestId = req.requestId || 'req_unknown';

  if (res.locals.demoMode === true) {
    res.json({
      success: true,
      data: PREDEFINED_TEMPLATES.map(template => ({ ...template, status: 'DEMO SAMPLE' })),
      meta: { totalCount: PREDEFINED_TEMPLATES.length, requestId, demoMode: true, source: 'demo-fixture' },
    });
    return;
  }

  if (isTestRuntime()) {
    res.json({ success: true, data: PREDEFINED_TEMPLATES, meta: { totalCount: PREDEFINED_TEMPLATES.length, requestId, source: 'test-fixture' } });
    return;
  }

  let config: any;
  try {
    config = await loadTenantWhatsAppConfig(tenantId);
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[WhatsApp Templates] Config lookup failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_CONFIG_UNAVAILABLE', 'Saved WhatsApp provider configuration could not be loaded.');
    return;
  }

  if (!config || config.status !== 'connected' || config.provider !== 'cloud_api' ||
      !config.businessAccountId || !config.accessToken) {
    res.status(409).json({
      success: false,
      error: { code: 'WHATSAPP_TEMPLATES_NOT_CONFIGURED', message: 'Verified Meta Cloud API credentials and a WhatsApp Business Account ID are required to load actual templates.', requestId },
    });
    return;
  }

  try {
    const version = getMetaGraphApiVersion();
    const endpoint = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(config.businessAccountId)}/message_templates`);
    endpoint.searchParams.set('fields', 'name,status,language,category,components');
    endpoint.searchParams.set('limit', '100');
    const response = await fetch(endpoint.toString(), {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => ({} as any));
    if (!response.ok || payload.error) {
      const upstreamStatus = response.status;
      console.error('[WhatsApp Templates] Meta request failed', { requestId, upstreamStatus, code: payload.error?.code });
      res.status(502).json({
        success: false,
        error: { code: 'META_TEMPLATE_FETCH_FAILED', message: payload.error?.message || `Meta template request failed (HTTP ${upstreamStatus}).`, requestId },
      });
      return;
    }

    const templates = Array.isArray(payload.data) ? payload.data.map((item: any) => ({
      id: item.id,
      name: item.name,
      language: item.language,
      category: item.category,
      status: item.status,
      components: item.components || [],
    })) : [];
    res.json({ success: true, data: templates, meta: { totalCount: templates.length, requestId, source: 'meta-cloud-api' } });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'TimeoutError';
    console.error('[WhatsApp Templates] Fetch failed', { requestId, errorCode: aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE' });
    res.status(502).json({
      success: false,
      error: { code: 'META_TEMPLATE_FETCH_FAILED', message: aborted ? 'Meta template request timed out.' : 'Unable to reach Meta to load templates.', requestId },
    });
  }
});

export default router;
