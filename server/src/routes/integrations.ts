import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';
import { encryptSecret, decryptSecret, maskSecret } from '../services/whatsapp/adapterRegistry';

const router = Router();

const webhookRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'WEBHOOK_RATE_LIMITED',
        message: 'Too many lead-capture requests. Retry shortly.',
        requestId: req.requestId || 'req_unknown',
      },
    });
  },
});

function databaseUnavailable(res: Response, requestId: string): void {
  res.status(503).json({
    success: false,
    error: {
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is temporarily unavailable. Please retry shortly.',
      requestId,
    },
  });
}

function safeSecretEquals(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function roleHasDatabase(req: Request): boolean {
  return !resolveDatabaseConfig().isBlocked;
}

// Public website lead-capture endpoint. Requests must provide tenantSlug plus the
// workspace-specific secret in x-oneclick-webhook-secret over HTTPS.
router.post('/lead-capture', webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (!roleHasDatabase(req)) {
    databaseUnavailable(res, requestId);
    return;
  }

  const tenantSlug = typeof req.body?.tenantSlug === 'string' ? req.body.tenantSlug.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phoneRaw = typeof req.body?.phoneRaw === 'string' ? req.body.phoneRaw.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const companyName = typeof req.body?.companyName === 'string' ? req.body.companyName.trim() : '';
  const digits = phoneRaw.replace(/\D/g, '');
  const receivedSecret = req.get('x-oneclick-webhook-secret') || '';

  if (!tenantSlug || !name || name.length > 255 || digits.length < 7 || digits.length > 15) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'tenantSlug, a lead name, and a valid phone number are required.',
        requestId,
      },
    });
    return;
  }
  if (email && (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Email address is invalid.', requestId },
    });
    return;
  }

  try {
    const tenantResult = await pool.query<{ id: string; slug: string }>(
      `SELECT id::text AS id, slug
         FROM tenants
        WHERE slug = $1 AND status = 'active'
        LIMIT 1;`,
      [tenantSlug]
    );
    if (tenantResult.rows.length === 0) {
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_UNAUTHORIZED', message: 'Webhook authentication failed.', requestId },
      });
      return;
    }

    const tenant = tenantResult.rows[0];
    const settingsResult = await pool.query<{ config_data: any }>(
      `SELECT config_data
         FROM tenant_settings
        WHERE tenant_id = $1::uuid AND category = 'website_webhook'
        LIMIT 1;`,
      [tenant.id]
    );
    const encryptedSecret = settingsResult.rows[0]?.config_data?.secretEncrypted;
    const expectedSecret = encryptedSecret ? decryptSecret(encryptedSecret) : '';
    if (!safeSecretEquals(receivedSecret, expectedSecret)) {
      res.status(401).json({
        success: false,
        error: { code: 'WEBHOOK_UNAUTHORIZED', message: 'Webhook authentication failed.', requestId },
      });
      return;
    }

    const stageResult = await pool.query<{ id: string }>(
      `SELECT id::text AS id
         FROM pipeline_stages
        WHERE tenant_id = $1::uuid AND active = true
        ORDER BY sort_order ASC
        LIMIT 1;`,
      [tenant.id]
    );
    if (stageResult.rows.length === 0) {
      res.status(503).json({
        success: false,
        error: { code: 'WORKSPACE_NOT_INITIALIZED', message: 'This workspace needs its default pipeline stages before leads can be accepted.', requestId },
      });
      return;
    }

    const consentStatus = req.body?.consentStatus === 'Consented'
      ? 'Consented'
      : req.body?.consentStatus === 'Opted Out' ? 'Opted Out' : 'Unknown';
    const inserted = await pool.query<{
      id: string; name: string; phone_raw: string; email: string | null; created_at: Date;
    }>(
      `INSERT INTO leads (
        tenant_id, name, phone_raw, phone_normalized, email, company_name, source,
        stage_id, consent_status, opted_out_at
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6, 'Website', $7::uuid, $8,
              CASE WHEN $8 = 'Opted Out' THEN NOW() ELSE NULL END)
      RETURNING id::text AS id, name, phone_raw, email, created_at;`,
      [tenant.id, name, phoneRaw, `+${digits}`, email || null, companyName || null,
       stageResult.rows[0].id, consentStatus]
    );
    res.status(201).json({
      success: true,
      data: {
        leadId: inserted.rows[0].id,
        name: inserted.rows[0].name,
        phoneRaw: inserted.rows[0].phone_raw,
        email: inserted.rows[0].email,
        createdAt: inserted.rows[0].created_at,
      },
      meta: { requestId },
    });
  } catch {
    databaseUnavailable(res, requestId);
  }
});

// Authenticated workspace integration status. Secrets are never returned here.
router.get('/status', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (!roleHasDatabase(req)) {
    databaseUnavailable(res, requestId);
    return;
  }

  try {
    const tenantId = req.tenantContext!.tenantId;
    const [tenantResult, settingsResult] = await Promise.all([
      pool.query<{ slug: string }>('SELECT slug FROM tenants WHERE id = $1::uuid LIMIT 1;', [tenantId]),
      pool.query<{ category: string; config_data: any }>(
        `SELECT category, config_data
           FROM tenant_settings
          WHERE tenant_id = $1::uuid AND category = ANY($2::text[]);`,
        [tenantId, ['website_webhook', 'whatsapp', 'ai']]
      ),
    ]);
    const settings = new Map(settingsResult.rows.map((row) => [row.category, row.config_data || {}]));
    const webhookConfig = settings.get('website_webhook');
    const whatsappConfig = settings.get('whatsapp');
    const aiConfig = settings.get('ai');
    const publicApiBase = (process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
    const webhookUrl = publicApiBase
      ? `${publicApiBase}/api/integrations/lead-capture`
      : `${req.protocol}://${req.get('host')}/api/integrations/lead-capture`;

    res.json({
      success: true,
      data: {
        tenantSlug: tenantResult.rows[0]?.slug || '',
        webhook: {
          configured: Boolean(webhookConfig?.secretEncrypted),
          secretMasked: webhookConfig?.secretEncrypted
            ? maskSecret(decryptSecret(webhookConfig.secretEncrypted)) : '',
          endpoint: webhookUrl,
          status: webhookConfig?.secretEncrypted ? 'configured' : 'unconfigured',
        },
        whatsapp: {
          configured: Boolean(whatsappConfig && whatsappConfig.provider && whatsappConfig.status === 'connected'),
          provider: whatsappConfig?.provider || '',
          status: whatsappConfig?.status || 'unconfigured',
        },
        ai: {
          configured: Boolean(aiConfig && aiConfig.enabled && aiConfig.status === 'active'),
          provider: aiConfig?.provider || '',
          status: aiConfig?.status || 'unconfigured',
          mode: aiConfig?.mode || 'disabled',
        },
      },
      meta: { requestId },
    });
  } catch {
    databaseUnavailable(res, requestId);
  }
});

// Rotate the workspace webhook secret. Plain secret is returned once to the authorized administrator.
router.post('/website-webhook/rotate', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (!roleHasDatabase(req)) {
    databaseUnavailable(res, requestId);
    return;
  }

  const tenantId = req.tenantContext!.tenantId;
  const newSecret = crypto.randomBytes(32).toString('hex');
  const configData = {
    secretEncrypted: encryptSecret(newSecret),
    status: 'configured',
    rotatedAt: new Date().toISOString(),
  };

  try {
    const result = await pool.query<{ slug: string }>(
      'SELECT slug FROM tenants WHERE id = $1::uuid AND status = $2 LIMIT 1;',
      [tenantId, 'active']
    );
    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace was not found.', requestId },
      });
      return;
    }
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, category, config_data, updated_by, updated_at)
       VALUES ($1::uuid, 'website_webhook', $2::jsonb, $3::uuid, NOW())
       ON CONFLICT (tenant_id, category)
       DO UPDATE SET config_data = EXCLUDED.config_data, updated_by = EXCLUDED.updated_by, updated_at = NOW();`,
      [tenantId, JSON.stringify(configData), req.userId]
    );

    const externalAccountId = result.rows[0].slug;
    const updated = await pool.query(
      `UPDATE integrations
          SET status = 'Connected', external_account_id = $2, credential_reference = 'tenant_settings:website_webhook', updated_at = NOW()
        WHERE tenant_id = $1::uuid AND provider = 'website_webhook';`,
      [tenantId, externalAccountId]
    );
    if (updated.rowCount === 0) {
      await pool.query(
        `INSERT INTO integrations (tenant_id, provider, status, external_account_id, credential_reference)
         VALUES ($1::uuid, 'website_webhook', 'Connected', $2, 'tenant_settings:website_webhook');`,
        [tenantId, externalAccountId]
      );
    }

    const publicApiBase = (process.env.PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
    const webhookUrl = publicApiBase
      ? `${publicApiBase}/api/integrations/lead-capture`
      : `${req.protocol}://${req.get('host')}/api/integrations/lead-capture`;
    res.json({
      success: true,
      data: {
        secret: newSecret,
        tenantSlug: externalAccountId,
        webhookUrl,
        secretDisplayedOnce: true,
        note: 'Copy this secret now. The previous secret is invalid and cannot be retrieved again.',
      },
      meta: { requestId },
    });
  } catch {
    databaseUnavailable(res, requestId);
  }
});

export default router;
