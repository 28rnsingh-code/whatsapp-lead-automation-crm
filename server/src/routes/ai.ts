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
} from '../services/ai/aiRegistry';
import { AiConfig } from '../services/ai/types';
import { reserveMonthlyUsage, releaseMonthlyUsage, reconcileMonthlyUsage, PlanQuotaExceededError, SubscriptionAccessError, MonthlyUsageReservation } from '../services/billing/usageMetering';
import { getWhatsAppAdapter } from '../services/whatsapp/adapterRegistry';

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

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

async function loadTenantAiConfig(tenantId: string, rawTenantId: string): Promise<AiConfig> {
  const database = resolveDatabaseConfig();
  if (database.isBlocked) {
    if (!isTestRuntime()) throw new Error('AI_DATABASE_CONFIGURATION_INVALID');
    return IN_MEMORY_AI_CONFIGS[rawTenantId] || {
      provider: 'mock',
      model: 'mock-fast-reply',
      mode: 'disabled',
      systemPrompt: 'You are an intelligent CRM assistant.',
      businessContext: '',
      confidenceThreshold: 0.75,
      maxOutputChars: 250,
      enabled: false,
      status: 'unconfigured',
    };
  }

  const result = await pool.query(
    `SELECT config_data FROM tenant_settings WHERE tenant_id = $1 AND category = 'ai' LIMIT 1`,
    [tenantId],
  );
  if (!result.rows.length) {
    return {
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'disabled',
      systemPrompt: 'You are an intelligent CRM assistant.',
      businessContext: '',
      confidenceThreshold: 0.75,
      maxOutputChars: 250,
      enabled: false,
      status: 'unconfigured',
    };
  }

  const stored = typeof result.rows[0].config_data === 'string'
    ? JSON.parse(result.rows[0].config_data)
    : result.rows[0].config_data;
  const apiKey = typeof stored.apiKey === 'string' && stored.apiKey
    ? decryptSecret(stored.apiKey)
    : undefined;
  return {
    provider: stored.provider || 'mock',
    apiKey,
    model: stored.model || 'mock-fast-reply',
    mode: stored.mode || 'disabled',
    systemPrompt: stored.systemPrompt || 'You are an intelligent, courteous sales representative.',
    businessContext: stored.businessContext || '',
    confidenceThreshold: Number(stored.confidenceThreshold) || 0.75,
    maxOutputChars: Number(stored.maxOutputChars) || 250,
    enabled: stored.enabled === true,
    status: stored.status || (stored.enabled === true ? 'active' : 'unconfigured'),
    errorMessage: stored.errorMessage,
    lastTestedAt: stored.lastTestedAt,
  } as AiConfig;
}

// 1. GET /api/ai/config - Fetch Tenant AI Settings (Masked)
router.get('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const dbConfig = resolveDatabaseConfig();

  if (dbConfig.isBlocked) {
    const raw = IN_MEMORY_AI_CONFIGS[rawTenantId] || {
      provider: 'mock',
      model: 'mock-fast-reply',
      mode: 'draft_only',
      confidenceThreshold: 0.75,
      maxOutputChars: 300,
      enabled: false,
      status: 'unconfigured',
    };

    res.json({
      success: true,
      data: {
        config: maskAiConfig(raw as AiConfig),
        supportedProviders: getAllSupportedAiProviders(),
      },
      meta: { requestId },
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT config_data FROM tenant_settings WHERE tenant_id = $1 AND category = 'ai' LIMIT 1;`,
      [tenantId]
    );

    let raw: any = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      mode: 'draft_only',
      confidenceThreshold: 0.8,
      maxOutputChars: 300,
      enabled: false,
      status: 'unconfigured',
    };

    if (result.rows.length > 0) {
      raw = result.rows[0].config_data;
      if (raw.apiKey) raw.apiKey = decryptSecret(raw.apiKey);
    }

    res.json({
      success: true,
      data: {
        config: maskAiConfig(raw as AiConfig),
        supportedProviders: getAllSupportedAiProviders(),
      },
      meta: { requestId },
    });
  } catch (error: any) {
    res.json({
      success: true,
      data: {
        config: maskAiConfig({
          provider: 'mock',
          model: 'mock-fast-reply',
          mode: 'disabled',
          confidenceThreshold: 0.75,
          maxOutputChars: 300,
          enabled: false,
          status: 'unconfigured',
        }),
        supportedProviders: getAllSupportedAiProviders(),
      },
      meta: { requestId },
    });
  }
});

// 2. POST /api/ai/config - Save & Verify Tenant AI Settings
router.post('/config', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
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
  } = req.body;

  const adapter = getAiAdapter(provider);
  let validation: { valid: boolean; error?: string } = { valid: true };

  if (apiKey) {
    const keyCheck = await adapter.validateKey(apiKey, model);
    validation = { valid: keyCheck.valid, error: keyCheck.error };
  } else if (enabled && provider !== 'mock') {
    validation = { valid: false, error: 'API key is required when enabling external AI providers.' };
  }

  const status = validation.valid ? 'active' : 'error';
  const newConfig: AiConfig = {
    provider,
    apiKey,
    model,
    mode,
    systemPrompt: systemPrompt || 'You are an intelligent, courteous sales representative.',
    businessContext: businessContext || '',
    confidenceThreshold: Number(confidenceThreshold) || 0.75,
    maxOutputChars: Number(maxOutputChars) || 250,
    enabled: !!enabled,
    status,
    errorMessage: validation.error,
    lastTestedAt: new Date().toISOString(),
  };

  const dbConfig = resolveDatabaseConfig();
  if (dbConfig.isBlocked) {
    IN_MEMORY_AI_CONFIGS[rawTenantId] = newConfig;
    res.json({
      success: true,
      data: {
        config: maskAiConfig(newConfig),
        validation,
      },
      meta: { requestId },
    });
    return;
  }

  try {
    const encryptedData = {
      ...newConfig,
      apiKey: apiKey ? encryptSecret(apiKey) : undefined,
    };

    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, category, config_data, updated_at)
       VALUES ($1, 'ai', $2, NOW())
       ON CONFLICT (tenant_id, category)
       DO UPDATE SET config_data = $2, updated_at = NOW();`,
      [tenantId, JSON.stringify(encryptedData)]
    );

    res.json({
      success: true,
      data: {
        config: maskAiConfig(newConfig),
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

// 3. POST /api/ai/generate-reply - Generate Contextual AI Response
router.post('/generate-reply', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const rawTenantId = req.tenantContext!.tenantId;
  const requestId = req.requestId || 'req_unknown';
  const { incomingMessage, leadName, companyName, conversationHistory } = req.body;

  if (typeof incomingMessage !== 'string' || !incomingMessage.trim()) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Incoming customer message is required.', requestId } });
    return;
  }

  let raw: AiConfig;
  try {
    raw = await loadTenantAiConfig(tenantId, rawTenantId);
  } catch (error) {
    console.error('[AI] Persisted tenant configuration could not be loaded', { requestId, error });
    res.status(503).json({ success: false, error: { code: 'AI_CONFIG_UNAVAILABLE', message: 'Saved AI configuration could not be loaded. Check the database and try again.', requestId } });
    return;
  }

  if (!raw.enabled || raw.mode === 'disabled' || raw.status === 'error' || raw.status === 'unconfigured') {
    res.status(409).json({ success: false, error: { code: 'AI_NOT_CONFIGURED', message: 'Enable an AI provider with valid credentials in workspace Settings before generating replies.', requestId } });
    return;
  }
  if (raw.provider !== 'mock' && !raw.apiKey) {
    res.status(409).json({ success: false, error: { code: 'AI_API_KEY_REQUIRED', message: 'The selected AI provider has no saved API key. Configure one in workspace Settings.', requestId } });
    return;
  }

  const historyText = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-20).map((item: any) => String(item?.sender || '') + ': ' + String(item?.text || '')).join('\n')
    : '';
  const contextText = [raw.systemPrompt || '', raw.businessContext || '', leadName || '', companyName || '', incomingMessage, historyText].join('\n');
  // Conservative estimate; after the provider responds we reconcile to its reported token usage.
  const estimatedTokens = Math.max(1, Math.ceil(contextText.length / 2) + Math.ceil(Math.min(Math.max(1, raw.maxOutputChars || 250), 4000) / 2) + 32);
  let usageReservation: MonthlyUsageReservation | null = null;
  if (!resolveDatabaseConfig().isBlocked) {
    try {
      usageReservation = await reserveMonthlyUsage(tenantId, 'aiTokens', estimatedTokens);
    } catch (error) {
      if (error instanceof PlanQuotaExceededError) {
        res.status(429).json({ success: false, error: { code: error.code, message: `Monthly AI token limit reached (${error.used}/${error.limit}). Upgrade your plan to continue.`, metric: error.metric, used: error.used, limit: error.limit, requested: error.requested, requestId } });
        return;
      }
      if (error instanceof SubscriptionAccessError) {
        res.status(402).json({ success: false, error: { code: error.code, message: 'This workspace subscription is not active. Update the plan before generating AI replies.', status: error.subscriptionStatus, requestId } });
        return;
      }
      console.error('[AI] Monthly usage reservation failed', { requestId, error });
      res.status(503).json({ success: false, error: { code: 'USAGE_METER_UNAVAILABLE', message: 'AI usage could not be verified. No AI request was sent.', requestId } });
      return;
    }
  }

  const adapter = getAiAdapter(raw.provider);
  let result;
  try {
    result = await adapter.generateReply({
      tenantId,
      leadName,
      companyName,
      incomingMessage: incomingMessage.trim(),
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory.slice(-20) : undefined,
      config: raw,
    });
  } catch (error) {
    // The upstream request may have consumed tokens even if the connection dropped; retain reservation.
    console.error('[AI] Provider result is unknown after a failed request', { requestId, error });
    res.status(502).json({ success: false, error: { code: 'AI_PROVIDER_RESULT_UNKNOWN', message: 'The AI provider result is unknown. Estimated token usage remains reserved; check provider status before retrying.', requestId } });
    return;
  }

  if (!result.success) {
    if (usageReservation) {
      const reportedTokens = Number.isFinite(result.tokensUsed) && Number(result.tokensUsed) > 0 ? Math.ceil(Number(result.tokensUsed)) : 0;
      if (reportedTokens > 0) {
        await reconcileMonthlyUsage(usageReservation, reportedTokens).catch((error) => console.error('[AI] Failed to reconcile provider-reported usage', { requestId, error }));
      } else {
        await releaseMonthlyUsage(usageReservation).catch((error) => console.error('[AI] Failed to release failed-generation reservation', { requestId, error }));
      }
    }
    res.status(502).json({ success: false, error: { code: 'AI_GENERATION_FAILED', message: result.error || 'Failed to generate an AI response.', requestId } });
    return;
  }

  const actualTokens = Number.isFinite(result.tokensUsed) && Number(result.tokensUsed) > 0 ? Math.ceil(Number(result.tokensUsed)) : estimatedTokens;
  if (usageReservation) {
    try {
      await reconcileMonthlyUsage(usageReservation, actualTokens);
    } catch (error) {
      console.error('[AI] Usage reconciliation failed after generation', { requestId, error });
      res.status(503).json({ success: false, error: { code: 'AI_USAGE_RECONCILIATION_FAILED', message: 'The reply was generated but its usage could not be reconciled. Contact the workspace administrator before retrying.', requestId } });
      return;
    }
  }

  const passesThreshold = result.confidence >= (raw.confidenceThreshold || 0.75);
  res.json({
    success: true,
    data: { replyText: result.replyText, confidence: result.confidence, tokensUsed: actualTokens, model: result.model, mode: raw.mode, passesThreshold, requiresApproval: raw.mode !== 'automatic_send' },
    meta: { requestId, usageEstimate: estimatedTokens, usageReconciled: true },
  });
});

// 4. POST /api/ai/approve-reply - Approve Draft & Dispatch to WhatsApp
router.post('/approve-reply', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const tenantId = toDbTenantId(req.tenantContext!.tenantId);
  const requestId = req.requestId || 'req_unknown';
  const { recipientPhone, replyText, leadId } = req.body;

  if (!recipientPhone || !replyText) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Recipient phone and reply text are required.', requestId },
    });
    return;
  }

  // Dispatch via WhatsApp adapter
  const adapter = getWhatsAppAdapter('mock');
  const sendResult = await adapter.sendMessage({
    tenantId,
    recipientPhone,
    messageType: 'text',
    body: replyText,
    leadId,
    credentials: { provider: 'mock' },
  });

  res.json({
    success: true,
    data: {
      message: 'AI response approved and dispatched successfully.',
      providerMessageId: sendResult.providerMessageId,
      status: sendResult.status,
    },
    meta: { requestId },
  });
});

export default router;
