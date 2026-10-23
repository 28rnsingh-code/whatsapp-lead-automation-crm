import { Router, Request, Response } from 'express';
import crypto from 'crypto';
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

const router = Router();

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

function sendWhatsAppUnavailable(res: Response, requestId: string, code: string, message: string): void {
  res.status(503).json({ success: false, error: { code, message, requestId } });
}

function normalizeWhatsAppPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

function sendExistingMessage(res: Response, existing: any, requestId: string, requestHash: string): void {
  if (!existing || !existing.idempotencyRequestHash || existing.idempotencyRequestHash !== requestHash) {
    res.status(409).json({
      success: false,
      error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'This idempotency key was already used for a different or unverified message request. Use a new key only for a genuinely new user action.', requestId },
    });
    return;
  }
  const payload = {
    id: existing.id,
    tenantId: existing.tenantId,
    leadId: existing.leadId,
    senderPhone: existing.senderPhone,
    recipientPhone: existing.recipientPhone,
    direction: existing.direction,
    messageType: existing.messageType,
    body: existing.body,
    status: existing.status,
    providerMessageId: existing.providerMessageId,
    createdAt: existing.createdAt,
  };
  if (existing.status === 'queued') {
    res.status(202).json({ success: true, data: payload, meta: { requestId, idempotentReplay: true, processing: true } });
    return;
  }
  if (existing.status === 'failed') {
    res.status(502).json({
      success: false,
      error: { code: 'WHATSAPP_PREVIOUS_ATTEMPT_FAILED', message: 'The previous attempt is recorded as failed and was not resent. Check provider/message history before creating a new send attempt.', requestId },
    });
    return;
  }
  res.status(200).json({ success: true, data: payload, meta: { requestId, idempotentReplay: true } });
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
    header: 'Welcome',
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
router.post('/config', requireAuth, requireTenant(['Admin', 'Sales Manager']), async (req: Request, res: Response): Promise<void> => {
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
       ORDER BY updated_at DESC;`,
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
  try {
    const result = await pool.query<{ tenant_id: string; config_data: any }>(
      `SELECT tenant_id, config_data
       FROM tenant_settings
       WHERE category = 'whatsapp'
         AND config_data->>'phoneNumberId' = $1
       LIMIT 2;`,
      [phoneNumberId],
    );
    if (result.rows.length !== 1) {
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_WORKSPACE_NOT_CONFIGURED', message: 'No unique workspace configuration matches this Meta phone number.', requestId },
      });
      return;
    }

    const row = result.rows[0];
    const config = typeof row.config_data === 'string' ? JSON.parse(row.config_data) : row.config_data;
    const appSecret = config?.appSecret ? decryptSecret(String(config.appSecret)) : '';
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

  // Resolve ownership only from the workspace configuration whose app secret
  // verified the exact request body. Ignore caller-controlled tenant headers.
  const tenantId = matchedTenantId!;
  let processed = 0;

  for (const event of events) {
    if (!event.providerMessageId || !event.providerMessageId.trim()) {
      console.warn('[WhatsApp Webhook] Skipping provider event without an ID', { requestId });
      continue;
    }

    try {
      if (event.statusUpdate) {
        const statusResult = await pool.query(
          `UPDATE whatsapp_messages
           SET status = $1,
               error_message = CASE WHEN $1 = 'failed' THEN 'Meta reported message delivery failure.' ELSE NULL END
           WHERE tenant_id = $2
             AND provider_message_id = $3
             AND direction = 'outbound'
           RETURNING id;`,
          [event.statusUpdate, tenantId, event.providerMessageId],
        );
        // A status callback can race the send response that records Meta's
        // provider ID. Ask Meta to retry rather than silently losing the update.
        if (statusResult.rowCount === 0) {
          res.status(503).json({
            success: false,
            error: { code: 'WHATSAPP_STATUS_NOT_READY', message: 'The outbound message is not yet available for status reconciliation; retry delivery.', requestId },
          });
          return;
        }
        processed += 1;
        continue;
      }

      const senderDigits = event.senderPhone.replace(/\D/g, '');
      let leadId: string | null = null;
      let contactId: string | null = null;

      const leadResult = await pool.query<{ id: string }>(
        `SELECT id
         FROM leads
         WHERE tenant_id = $1
           AND regexp_replace(phone_normalized, '[^0-9]', '', 'g') = $2
         ORDER BY created_at DESC
         LIMIT 1;`,
        [tenantId, senderDigits],
      );
      leadId = leadResult.rows[0]?.id || null;

      if (!leadId) {
        const contactResult = await pool.query<{ id: string }>(
          `SELECT id
           FROM contacts
           WHERE tenant_id = $1
             AND regexp_replace(phone_normalized, '[^0-9]', '', 'g') = $2
         ORDER BY created_at DESC
         LIMIT 1;`,
          [tenantId, senderDigits],
        );
        contactId = contactResult.rows[0]?.id || null;
      }

      await pool.query(
        `INSERT INTO whatsapp_messages (
           tenant_id, lead_id, contact_id, sender_phone, recipient_phone, direction,
           message_type, body, status, provider_message_id, idempotency_key, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'inbound', $6, $7, 'received', $8, $8, $9)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;`,
        [
          tenantId,
          leadId,
          contactId,
          event.senderPhone,
          event.recipientPhone,
          event.messageType,
          event.body,
          event.providerMessageId,
          event.timestamp,
        ],
      );
      processed += 1;
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
        : 'DATABASE_ERROR';
      console.error('[WhatsApp Webhook] Event persistence failed', { requestId, errorCode });
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

    if (leadId && typeof leadId === 'string') {
      params.push(leadId);
      whereSql += ` AND lead_id::text = ${params.length}`;
    } else if (phone && typeof phone === 'string') {
      params.push(phone);
      whereSql += ` AND (sender_phone = ${params.length} OR recipient_phone = ${params.length})`;
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

// 6. POST /api/whatsapp/messages - Policy-checked, idempotent outbound dispatch.
router.post('/messages', requireAuth, requireTenant(['Admin', 'Sales Manager', 'Sales Executive']), async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const {
    recipientPhone,
    body,
    templateName,
    templateLanguage,
    templateParameters,
    leadId,
    idempotencyKey,
  } = req.body || {};

  if (typeof recipientPhone !== 'string' || !recipientPhone.trim()) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Recipient phone number is required.', requestId },
    });
    return;
  }
  const normalizedRecipient = normalizeWhatsAppPhone(recipientPhone);
  if (!normalizedRecipient) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_RECIPIENT_PHONE', message: 'Enter a valid recipient phone number.', requestId },
    });
    return;
  }
  const hasTemplate = typeof templateName === 'string' && templateName.trim().length > 0;
  const messageBody = typeof body === 'string' ? body.trim() : '';
  if (!hasTemplate && !messageBody) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Message body or approved template name is required.', requestId },
    });
    return;
  }
  if (typeof leadId !== 'string' || !leadId.trim()) {
    res.status(400).json({
      success: false,
      error: { code: 'LEAD_REQUIRED', message: 'Select a CRM lead before sending a WhatsApp message.', requestId },
    });
    return;
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8 || idempotencyKey.trim().length > 255) {
    res.status(400).json({
      success: false,
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'A unique idempotency key is required to prevent duplicate message sends.', requestId },
    });
    return;
  }

  const stableKey = idempotencyKey.trim();
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({
    leadId: leadId.trim(),
    recipientPhone: normalizedRecipient,
    messageType: hasTemplate ? 'template' : 'text',
    body: hasTemplate ? '' : messageBody,
    templateName: hasTemplate ? templateName.trim() : '',
    templateLanguage: hasTemplate ? (typeof templateLanguage === 'string' ? templateLanguage.trim() : '') : '',
    templateParameters: hasTemplate && Array.isArray(templateParameters) ? templateParameters : [],
  })).digest('hex');

  // Idempotency is checked before any provider call. A duplicate click/retry may
  // return the original result, but must never dispatch a second provider message.
  try {
    const existingResult = await pool.query(
      `SELECT id, tenant_id as "tenantId", lead_id as "leadId", sender_phone as "senderPhone",
              recipient_phone as "recipientPhone", direction, message_type as "messageType",
              body, status, provider_message_id as "providerMessageId",
              idempotency_request_hash as "idempotencyRequestHash", created_at as "createdAt"
       FROM whatsapp_messages
       WHERE tenant_id = $1 AND idempotency_key = $2
       LIMIT 1;`,
      [tenantId, stableKey],
    );
    if (existingResult.rows.length) {
      sendExistingMessage(res, existingResult.rows[0], requestId, requestHash);
      return;
    }
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
      : 'DATABASE_ERROR';
    console.error('[WhatsApp Messages] Idempotency lookup failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_STORAGE_UNAVAILABLE', 'Message history could not be checked safely. No message was sent.');
    return;
  }

  // Require a real, persisted workspace provider configuration.
  let rawConfig: any = null;
  try {
    rawConfig = await loadTenantWhatsAppConfig(tenantId);
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[WhatsApp Messages] Provider configuration lookup failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_CONFIG_UNAVAILABLE', 'Saved provider configuration could not be loaded. No message was sent.');
    return;
  }
  if (!rawConfig || rawConfig.status !== 'connected') {
    res.status(409).json({
      success: false,
      error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'Configure and verify an actual WhatsApp provider before sending messages.', requestId },
    });
    return;
  }

  let adapter;
  try {
    adapter = getWhatsAppAdapter(rawConfig.provider);
  } catch {
    res.status(409).json({
      success: false,
      error: { code: 'WHATSAPP_PROVIDER_UNSUPPORTED', message: 'This WhatsApp provider is not implemented in the current release.', requestId },
    });
    return;
  }

  // Validate the target lead and explicit consent on the server; the UI is not
  // a trust boundary. Historical rows without evidence require re-confirmation.
  let lead: any;
  try {
    const leadResult = await pool.query(
      `SELECT id, phone_normalized as "phoneNormalized", consent_status as "consentStatus",
              consent_source as "consentSource", consent_recorded_at as "consentRecordedAt",
              opted_out_at as "optedOutAt"
       FROM leads
       WHERE tenant_id = $1 AND id::text = $2
       LIMIT 1;`,
      [tenantId, leadId.trim()],
    );
    lead = leadResult.rows[0];
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
      : 'DATABASE_ERROR';
    console.error('[WhatsApp Messages] Lead eligibility lookup failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_ELIGIBILITY_UNAVAILABLE', 'Lead consent could not be verified. No message was sent.');
    return;
  }
  if (!lead) {
    res.status(404).json({
      success: false,
      error: { code: 'LEAD_NOT_FOUND', message: 'The selected lead was not found in this workspace.', requestId },
    });
    return;
  }
  if (normalizeWhatsAppPhone(lead.phoneNormalized) !== normalizedRecipient) {
    res.status(400).json({
      success: false,
      error: { code: 'RECIPIENT_LEAD_MISMATCH', message: 'The recipient number does not match the selected CRM lead.', requestId },
    });
    return;
  }
  if (lead.consentStatus !== 'Consented' || !lead.consentSource || !lead.consentRecordedAt || lead.optedOutAt) {
    res.status(403).json({
      success: false,
      error: { code: 'WHATSAPP_CONSENT_REQUIRED', message: 'Explicit, recorded WhatsApp consent is required and the lead must not have opted out.', requestId },
    });
    return;
  }

  let effectiveTemplateLanguage = typeof templateLanguage === 'string' ? templateLanguage.trim() : '';
  let persistedBody = messageBody;
  if (hasTemplate) {
    if (rawConfig.provider !== 'cloud_api') {
      res.status(409).json({
        success: false,
        error: { code: 'WHATSAPP_TEMPLATE_PROVIDER_UNSUPPORTED', message: 'Approved template lookup is implemented only for the Meta Cloud API in this release.', requestId },
      });
      return;
    }

    let selectedTemplate: any = null;
    if (isTestRuntime()) {
      selectedTemplate = PREDEFINED_TEMPLATES.find((template) =>
        template.name === templateName.trim() &&
        (!effectiveTemplateLanguage || template.language === effectiveTemplateLanguage),
      ) || null;
    } else {
      if (!rawConfig.businessAccountId || !rawConfig.accessToken) {
        res.status(409).json({
          success: false,
          error: { code: 'WHATSAPP_TEMPLATES_NOT_CONFIGURED', message: 'Verified Meta business account credentials are required to verify this template.', requestId },
        });
        return;
      }
      try {
        const endpoint = new URL(`https://graph.facebook.com/${getMetaGraphApiVersion()}/${encodeURIComponent(rawConfig.businessAccountId)}/message_templates`);
        endpoint.searchParams.set('fields', 'name,status,language,category,components');
        endpoint.searchParams.set('name', templateName.trim());
        endpoint.searchParams.set('limit', '100');
        const response = await fetch(endpoint.toString(), {
          headers: { Authorization: `Bearer ${rawConfig.accessToken}` },
          signal: AbortSignal.timeout(8000),
        });
        const payload = await response.json().catch(() => ({} as any));
        if (!response.ok || payload.error) {
          const upstreamStatus = response.status;
          console.error('[WhatsApp Messages] Template verification failed', { requestId, upstreamStatus, code: payload.error?.code });
          res.status(502).json({
            success: false,
            error: { code: 'META_TEMPLATE_VERIFICATION_FAILED', message: payload.error?.message || `Meta template verification failed (HTTP ${upstreamStatus}). No message was sent.`, requestId },
          });
          return;
        }
        const templates = Array.isArray(payload.data) ? payload.data : [];
        selectedTemplate = templates.find((template: any) =>
          template.name === templateName.trim() &&
          template.status === 'APPROVED' &&
          (!effectiveTemplateLanguage || template.language === effectiveTemplateLanguage),
        ) || null;
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        res.status(502).json({
          success: false,
          error: { code: 'META_TEMPLATE_VERIFICATION_FAILED', message: timedOut ? 'Meta template verification timed out. No message was sent.' : 'Meta template verification is unavailable. No message was sent.', requestId },
        });
        return;
      }
    }

    if (!selectedTemplate || selectedTemplate.status !== 'APPROVED') {
      res.status(409).json({
        success: false,
        error: { code: 'WHATSAPP_TEMPLATE_NOT_APPROVED', message: 'Only an approved template from the configured provider can be sent.', requestId },
      });
      return;
    }
    effectiveTemplateLanguage = effectiveTemplateLanguage || selectedTemplate.language || 'en';
    if (!isTestRuntime()) {
      const headerComponent = Array.isArray(selectedTemplate.components)
        ? selectedTemplate.components.find((component: any) => component.type === 'HEADER')
        : undefined;
      const headerHasVariables = typeof headerComponent?.text === 'string' &&
        /\{\{\d+\}\}/.test(headerComponent.text);
      if (headerHasVariables || (headerComponent?.format && headerComponent.format !== 'TEXT')) {
        res.status(409).json({
          success: false,
          error: { code: 'WHATSAPP_TEMPLATE_HEADER_UNSUPPORTED', message: 'This approved template uses header parameters or media not supported by the current sender. Choose a compatible text-header template.', requestId },
        });
        return;
      }
      const bodyComponent = Array.isArray(selectedTemplate.components)
        ? selectedTemplate.components.find((component: any) => component.type === 'BODY')
        : undefined;
      const placeholders = typeof bodyComponent?.text === 'string'
        ? (bodyComponent.text.match(/\{\{\d+\}\}/g) || []).length
        : 0;
      const parameters = Array.isArray(templateParameters) ? templateParameters : [];
      if (parameters.length !== placeholders) {
        res.status(400).json({
          success: false,
          error: { code: 'WHATSAPP_TEMPLATE_PARAMETERS_MISMATCH', message: `The approved template requires ${placeholders} body parameter(s), but ${parameters.length} were provided.`, requestId },
        });
        return;
      }
    }
    persistedBody = `[Template: ${templateName.trim()}]`;
  } else {
    // WhatsApp customer-service free-form messages are only allowed within
    // 24 hours of the customer's last inbound message.
    try {
      const senderDigits = normalizedRecipient.replace(/\D/g, '');
      const inboundResult = await pool.query(
        `SELECT created_at
         FROM whatsapp_messages
         WHERE tenant_id = $1
           AND direction = 'inbound'
           AND (
             lead_id = $2
             OR (
               lead_id IS NULL
               AND regexp_replace(sender_phone, '[^0-9]', '', 'g') = $3
             )
           )
         ORDER BY created_at DESC
         LIMIT 1;`,
        [tenantId, lead.id, senderDigits],
      );
      const lastInboundAt = inboundResult.rows[0]?.created_at
        ? new Date(inboundResult.rows[0].created_at).getTime()
        : Number.NaN;
      const ageMs = Date.now() - lastInboundAt;
      if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 24 * 60 * 60 * 1000) {
        res.status(409).json({
          success: false,
          error: { code: 'WHATSAPP_TEMPLATE_REQUIRED', message: 'The 24-hour customer-service window is not open. Choose an approved template instead; no message was sent.', requestId },
        });
        return;
      }
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
        : 'DATABASE_ERROR';
      console.error('[WhatsApp Messages] Customer-service window lookup failed', { requestId, errorCode });
      sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_WINDOW_UNAVAILABLE', 'The customer-service window could not be verified. No message was sent.');
      return;
    }
  }

  const finalTemplateParameters = hasTemplate && Array.isArray(templateParameters)
    ? templateParameters.filter((value: unknown): value is string => typeof value === 'string')
    : undefined;

  // Persist intent before calling the provider. If a timeout occurs after Meta
  // accepts a message, retrying with this key returns the stored row and cannot
  // accidentally dispatch a second message.
  let queued: any;
  try {
    const inserted = await pool.query(
      `INSERT INTO whatsapp_messages (
         tenant_id, lead_id, sender_phone, recipient_phone, direction, message_type,
         body, status, idempotency_key, idempotency_request_hash, created_at
       ) VALUES ($1, $2, $3, $4, 'outbound', $5, $6, 'queued', $7, $8, NOW())
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING id, tenant_id as "tenantId", lead_id as "leadId", sender_phone as "senderPhone",
                 recipient_phone as "recipientPhone", direction, message_type as "messageType",
                 body, status, provider_message_id as "providerMessageId",
                 idempotency_request_hash as "idempotencyRequestHash", created_at as "createdAt";`,
      [
        tenantId,
        lead.id,
        rawConfig.displayPhoneNumber || rawConfig.sourceNumber || '',
        normalizedRecipient,
        hasTemplate ? 'template' : 'text',
        persistedBody,
        stableKey,
        requestHash,
      ],
    );
    queued = inserted.rows[0] || null;
    if (!queued) {
      const existingResult = await pool.query(
        `SELECT id, tenant_id as "tenantId", lead_id as "leadId", sender_phone as "senderPhone",
                recipient_phone as "recipientPhone", direction, message_type as "messageType",
                body, status, provider_message_id as "providerMessageId",
                idempotency_request_hash as "idempotencyRequestHash", created_at as "createdAt"
         FROM whatsapp_messages
         WHERE tenant_id = $1 AND idempotency_key = $2
         LIMIT 1;`,
        [tenantId, stableKey],
      );
      sendExistingMessage(res, existingResult.rows[0], requestId, requestHash);
      return;
    }
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
      : 'DATABASE_ERROR';
    console.error('[WhatsApp Messages] Queue persistence failed', { requestId, errorCode });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_QUEUE_FAILED', 'The message could not be safely queued. No message was sent.');
    return;
  }

  let sendResult;
  try {
    sendResult = await adapter.sendMessage({
      tenantId,
      recipientPhone: normalizedRecipient,
      messageType: hasTemplate ? 'template' : 'text',
      body: messageBody || `Template: ${templateName}`,
      templateName: hasTemplate ? templateName.trim() : undefined,
      templateLanguage: hasTemplate ? effectiveTemplateLanguage : undefined,
      templateParameters: finalTemplateParameters,
      idempotencyKey: stableKey,
      leadId: lead.id,
      credentials: rawConfig,
    });
  } catch (error) {
    console.error('[WhatsApp Messages] Provider adapter threw unexpectedly', { requestId });
    sendResult = { success: false, status: 'failed' as const, error: 'WhatsApp provider request failed unexpectedly.' };
  }

  if (!sendResult.success) {
    try {
      await pool.query(
        `UPDATE whatsapp_messages
         SET status = 'failed', error_message = $1
         WHERE tenant_id = $2 AND id = $3;`,
        [(sendResult.error || 'Provider rejected the message.').slice(0, 1000), tenantId, queued.id],
      );
    } catch (error) {
      console.error('[WhatsApp Messages] Failed to persist provider failure status', { requestId });
    }
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

  try {
    const updated = await pool.query(
      `UPDATE whatsapp_messages
       SET status = $1, provider_message_id = $2, error_message = NULL
       WHERE tenant_id = $3 AND id = $4
       RETURNING id, tenant_id as "tenantId", lead_id as "leadId", direction,
                 sender_phone as "senderPhone", recipient_phone as "recipientPhone",
                 message_type as "messageType", body, status,
                 provider_message_id as "providerMessageId", created_at as "createdAt";`,
      [sendResult.status, sendResult.providerMessageId || null, tenantId, queued.id],
    );
    if (!updated.rows[0]) {
      sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_STATUS_PERSIST_FAILED', 'The provider accepted the send request but message status could not be confirmed. Check message history before retrying.');
      return;
    }
    res.status(201).json({ success: true, data: updated.rows[0], meta: { requestId } });
  } catch (error) {
    console.error('[WhatsApp Messages] Provider accepted send but status persistence failed', { requestId });
    sendWhatsAppUnavailable(res, requestId, 'WHATSAPP_STATUS_PERSIST_FAILED', 'The provider may have accepted the message but the final status could not be stored. Check message history before retrying.');
  }
});

// 7. GET /api/whatsapp/templates - Live Meta templates, local samples only in automated tests.
router.get('/templates', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const requestId = req.requestId || 'req_unknown';

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
