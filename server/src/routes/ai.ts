import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';
import { DEFAULT_TENANT_ID } from '../db/seed';
import {
  getAiAdapter,
  getAllSupportedAiProviders,
  maskAiConfig,
  encryptSecret,
  decryptSecret,
  hasSecureEncryptionKey,
} from '../services/ai/aiRegistry';
import { AiConfig } from '../services/ai/types';

const router = Router();

const TENANT_UUID_MAP: Record<string, string> = {
  tenant_bring_my_bite: DEFAULT_TENANT_ID,
  tenant_automics_labs: 'a0000000-0000-0000-0000-000000000002',
};

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

function isTestFixtureMode(): boolean {
  return (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') &&
    resolveDatabaseConfig().isBlocked;
}

function toDbTenantId(id: string): string {
  if (!id) return DEFAULT_TENANT_ID;
  if (TENANT_UUID_MAP[id]) return TENANT_UUID_MAP[id];
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  return DEFAULT_TENANT_ID;
}

// In-memory fallback
const IN_MEMORY_AI_CONFIGS: Record<string, AiConfig> = {
  tenant_bring_my_bite: {
    provider: 'openai',
    apiKey: 'test_openai_key_bring_my_bite_9876',
    model: 'gpt-4o-mini',
    mode: 'draft_only',
    systemPrompt: 'You are an intelligent, friendly customer advisor for Bring My Bite CRM.',
    businessContext: 'We provide WhatsApp lead automation and food ordering operations.',
    confidenceThreshold: 0.8,
    maxOutputChars: 250,
    enabled: true,
    status: 'active',
    lastTestedAt: new Date().toISOString(),
  },
};

// 1. GET /api/ai/config - Fetch persistent tenant AI Settings (Masked)
router.get('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  if (isProductionRuntime() && !hasSecureEncryptionKey()) {
    res.status(503).json({
      success: false,
      error: { code: 'AI_ENCRYPTION_KEY_MISSING', message: 'AI settings cannot be read safely until a unique persistent ENCRYPTION_KEY is configured.', requestId: req.requestId || 'req_unknown' },
    });
    return;
  }

  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (isTestFixtureMode()) {
    const fixture = IN_MEMORY_AI_CONFIGS[rawTenantId] || {
      provider: 'mock',
      model: 'mock-fast-reply',
      mode: 'disabled',
      confidenceThreshold: 0.75,
      maxOutputChars: 300,
      enabled: false,
      status: 'unconfigured',
    };
    res.json({
      success: true,
      data: { config: maskAiConfig(fixture as AiConfig), supportedProviders: getAllSupportedAiProviders() },
      meta: { requestId, source: 'test-fixture' },
    });
    return;
  }
  if (dbConfig.isBlocked) {
    res.status(503).json({
      success: false,
      error: { code: 'AI_CONFIG_UNAVAILABLE', message: 'Persistent database configuration is unsafe or unavailable.', requestId },
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT config_data FROM tenant_settings WHERE tenant_id = $1 AND category = 'ai' LIMIT 1;`,
      [tenantId],
    );
    let raw: any = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'disabled',
      confidenceThreshold: 0.8,
      maxOutputChars: 300,
      enabled: false,
      status: 'unconfigured',
    };
    if (result.rows.length > 0) {
      raw = typeof result.rows[0].config_data === 'string'
        ? JSON.parse(result.rows[0].config_data)
        : result.rows[0].config_data;
      if (raw.apiKey) raw.apiKey = decryptSecret(String(raw.apiKey));
    }
    res.json({
      success: true,
      data: { config: maskAiConfig(raw as AiConfig), supportedProviders: getAllSupportedAiProviders() },
      meta: { requestId },
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
      : 'DATABASE_ERROR';
    console.error('[AI Config] Read failed', { requestId, errorCode });
    res.status(503).json({
      success: false,
      error: { code: 'AI_CONFIG_UNAVAILABLE', message: 'Saved AI settings could not be loaded. Please retry.', requestId },
    });
  }
});

// 2. POST /api/ai/config - Validate and persist tenant AI settings
router.post('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  if (isProductionRuntime() && !hasSecureEncryptionKey()) {
    res.status(503).json({
      success: false,
      error: { code: 'AI_ENCRYPTION_KEY_MISSING', message: 'AI credentials cannot be saved until a unique persistent ENCRYPTION_KEY is configured.', requestId: req.requestId || 'req_unknown' },
    });
    return;
  }

  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked && !isTestFixtureMode()) {
    res.status(503).json({
      success: false,
      error: { code: 'AI_CONFIG_UNAVAILABLE', message: 'Persistent database configuration is unsafe or unavailable.', requestId },
    });
    return;
  }

  const {
    provider = 'openai',
    apiKey,
    model = 'gpt-4o-mini',
    mode = 'draft_only',
    systemPrompt,
    businessContext,
    confidenceThreshold = 0.8,
    maxOutputChars = 250,
    enabled = true,
  } = req.body || {};

  if (mode === 'automatic_send') {
    res.status(409).json({
      success: false,
      error: { code: 'AI_AUTOMATIC_SEND_UNSUPPORTED', message: 'Automatic sending is disabled in this release. Use draft-only or approval-required mode so every outbound message passes WhatsApp consent, template, and messaging-window checks.', requestId },
    });
    return;
  }
  if (!['disabled', 'draft_only', 'approval_before_send'].includes(mode)) {
    res.status(400).json({
      success: false,
      error: { code: 'AI_MODE_INVALID', message: 'Choose a supported AI mode.', requestId },
    });
    return;
  }

  let adapter;
  try {
    adapter = getAiAdapter(provider);
  } catch {
    res.status(400).json({
      success: false,
      error: { code: 'AI_PROVIDER_UNSUPPORTED', message: 'This AI provider is not implemented in this release.', requestId },
    });
    return;
  }

  let effectiveApiKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : undefined;
  if (!effectiveApiKey && provider !== 'mock') {
    if (isTestFixtureMode()) {
      const previous = IN_MEMORY_AI_CONFIGS[rawTenantId];
      if (previous?.provider === provider && previous.apiKey) effectiveApiKey = previous.apiKey;
    } else {
      try {
        const previousResult = await pool.query(
          `SELECT config_data FROM tenant_settings WHERE tenant_id = $1 AND category = 'ai' LIMIT 1;`,
          [tenantId],
        );
        if (previousResult.rows.length) {
          const previous = typeof previousResult.rows[0].config_data === 'string'
            ? JSON.parse(previousResult.rows[0].config_data)
            : previousResult.rows[0].config_data;
          if (previous.provider === provider && previous.apiKey) {
            effectiveApiKey = decryptSecret(String(previous.apiKey));
          }
        }
      } catch (error) {
        const errorCode = error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
          : 'DATABASE_ERROR';
        console.error('[AI Config] Existing credential lookup failed', { requestId, errorCode });
        res.status(503).json({
          success: false,
          error: { code: 'AI_CONFIG_UNAVAILABLE', message: 'The existing AI credential could not be retrieved safely. Settings were not changed.', requestId },
        });
        return;
      }
    }
  }

  let validation: { valid: boolean; error?: string } = { valid: true };
  if (effectiveApiKey) {
    const keyCheck = await adapter.validateKey(effectiveApiKey, String(model));
    validation = { valid: keyCheck.valid, error: keyCheck.error };
  } else if (enabled && provider !== 'mock') {
    validation = { valid: false, error: 'A provider API key is required when enabling an external AI provider. The previously saved key is preserved only when the provider remains unchanged.' };
  }
  if (!validation.valid) {
    res.status(400).json({
      success: false,
      error: { code: 'AI_CREDENTIALS_INVALID', message: validation.error || 'AI provider credentials were not verified; settings were not saved.', requestId },
    });
    return;
  }

  const newConfig: AiConfig = {
    provider,
    apiKey: effectiveApiKey,
    model,
    mode,
    systemPrompt: systemPrompt || 'You are an intelligent, courteous sales representative.',
    businessContext: businessContext || '',
    confidenceThreshold: Number(confidenceThreshold) || 0.75,
    maxOutputChars: Number(maxOutputChars) || 250,
    enabled: !!enabled,
    status: 'active',
    lastTestedAt: new Date().toISOString(),
  };

  if (isTestFixtureMode()) {
    IN_MEMORY_AI_CONFIGS[rawTenantId] = newConfig;
    res.json({
      success: true,
      data: { config: maskAiConfig(newConfig), validation },
      meta: { requestId, source: 'test-fixture' },
    });
    return;
  }

  try {
    const encryptedData = {
      ...newConfig,
      apiKey: effectiveApiKey ? encryptSecret(effectiveApiKey) : undefined,
    };
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, category, config_data, updated_at)
       VALUES ($1, 'ai', $2, NOW())
       ON CONFLICT (tenant_id, category)
       DO UPDATE SET config_data = $2, updated_at = NOW();`,
      [tenantId, JSON.stringify(encryptedData)],
    );
    res.json({
      success: true,
      data: { config: maskAiConfig(newConfig), validation },
      meta: { requestId },
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
      : 'DATABASE_ERROR';
    console.error('[AI Config] Save failed', { requestId, errorCode });
    res.status(503).json({
      success: false,
      error: { code: 'AI_CONFIG_SAVE_FAILED', message: 'AI settings could not be saved to persistent storage.', requestId },
    });
  }
});

// 3. POST /api/ai/generate-reply - Generate a draft from saved tenant configuration.
router.post('/generate-reply', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  if (isProductionRuntime() && !hasSecureEncryptionKey()) {
    res.status(503).json({
      success: false,
      error: { code: 'AI_ENCRYPTION_KEY_MISSING', message: 'AI replies are disabled until a unique persistent ENCRYPTION_KEY is configured.', requestId: req.requestId || 'req_unknown' },
    });
    return;
  }

  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { incomingMessage, leadName, companyName, conversationHistory } = req.body || {};

  if (typeof incomingMessage !== 'string' || !incomingMessage.trim()) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Incoming customer message is required.', requestId },
    });
    return;
  }

  let raw: any = null;
  if (isTestFixtureMode()) {
    raw = IN_MEMORY_AI_CONFIGS[rawTenantId] || null;
  } else {
    if (resolveDatabaseConfig().isBlocked) {
      res.status(503).json({
        success: false,
        error: { code: 'AI_CONFIG_UNAVAILABLE', message: 'Persistent AI settings are unavailable. No reply was generated.', requestId },
      });
      return;
    }
    try {
      const result = await pool.query(
        `SELECT config_data FROM tenant_settings WHERE tenant_id = $1 AND category = 'ai' LIMIT 1;`,
        [tenantId],
      );
      if (result.rows.length) {
        raw = typeof result.rows[0].config_data === 'string'
          ? JSON.parse(result.rows[0].config_data)
          : result.rows[0].config_data;
        if (raw.apiKey) raw.apiKey = decryptSecret(String(raw.apiKey));
      }
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || 'DATABASE_ERROR')
        : 'DATABASE_ERROR';
      console.error('[AI Reply] Configuration lookup failed', { requestId, errorCode });
      res.status(503).json({
        success: false,
        error: { code: 'AI_CONFIG_UNAVAILABLE', message: 'Saved AI settings could not be loaded. No reply was generated.', requestId },
      });
      return;
    }
  }

  if (raw?.mode === 'automatic_send') {
    res.status(409).json({
      success: false,
      error: { code: 'AI_AUTOMATIC_SEND_UNSUPPORTED', message: 'The saved AI settings use automatic-send mode, which this release does not execute. Change the setting to approval-required mode before generating replies.', requestId },
    });
    return;
  }
  if (!raw || raw.status === 'error' || raw.status === 'unconfigured' || !raw.enabled || raw.mode === 'disabled') {
    res.status(409).json({
      success: false,
      error: { code: 'AI_NOT_CONFIGURED', message: 'Configure and verify an enabled AI provider before generating a reply.', requestId },
    });
    return;
  }

  let adapter;
  try {
    adapter = getAiAdapter(raw.provider);
  } catch {
    res.status(409).json({
      success: false,
      error: { code: 'AI_PROVIDER_UNSUPPORTED', message: 'The saved AI provider is not implemented in this release.', requestId },
    });
    return;
  }

  try {
    const result = await adapter.generateReply({
      tenantId,
      leadName,
      companyName,
      incomingMessage: incomingMessage.trim(),
      conversationHistory,
      config: raw as AiConfig,
    });
    if (!result.success) {
      res.status(502).json({
        success: false,
        error: { code: 'AI_GENERATION_FAILED', message: result.error || 'Failed to generate AI response.', requestId },
      });
      return;
    }

    const passesThreshold = result.confidence >= (raw.confidenceThreshold || 0.75);
    res.json({
      success: true,
      data: {
        replyText: result.replyText,
        confidence: result.confidence,
        tokensUsed: result.tokensUsed,
        model: result.model,
        mode: raw.mode,
        passesThreshold,
        requiresApproval: true,
      },
      meta: { requestId },
    });
  } catch (error) {
    console.error('[AI Reply] Provider adapter failed unexpectedly', { requestId });
    res.status(502).json({
      success: false,
      error: { code: 'AI_GENERATION_FAILED', message: 'AI provider request failed unexpectedly.', requestId },
    });
  }
});

// 4. POST /api/ai/approve-reply - Disabled legacy endpoint.
// Approved drafts must go through POST /api/whatsapp/messages, where consent,
// template and 24-hour-window rules plus idempotency are enforced.
router.post('/approve-reply', requireAuth, requireTenant(), (req: Request, res: Response): void => {
  res.status(410).json({
    success: false,
    error: {
      code: 'AI_APPROVAL_ROUTE_DISABLED',
      message: 'This legacy route does not send messages. Use the WhatsApp message endpoint so consent, messaging-window, and duplicate-send checks are applied.',
      requestId: req.requestId || 'req_unknown',
    },
  });
});

export default router;
