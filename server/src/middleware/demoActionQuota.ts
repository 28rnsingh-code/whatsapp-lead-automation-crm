import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';
import { pool } from '../db';

export const PUBLIC_DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000003';
export const PUBLIC_DEMO_EMAIL = 'demo@oneclick.local';
export const PUBLIC_DEMO_MAX_ACTIONS = 5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_PREFIXES = [
  '/auth/session',
  '/workspaces',
  '/leads',
  '/pipeline',
  '/tasks',
  '/contacts',
  '/companies',
  '/dashboard',
  '/reports',
  '/whatsapp/messages',
  '/whatsapp/templates',
  '/billing/plans',
  '/billing/subscription',
];

/**
 * Public demo access is isolated to one seeded tenant. Reads are allow-listed.
 * Mutations are allow-listed, atomically metered to five per signed session, and
 * the WhatsApp send route is explicitly marked to simulate rather than send.
 */
export async function demoActionQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (['/auth/login', '/auth/forgot-password', '/auth/reset-password', '/whatsapp/webhook', '/billing/webhook'].includes(req.path.toLowerCase())) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  let payload;
  try {
    payload = verifyToken(header.slice(7).trim());
  } catch {
    return next(); // The endpoint's normal auth middleware emits a 401.
  }

  if (!payload.demoSessionId || payload.demo !== true || payload.email !== PUBLIC_DEMO_EMAIL) return next();

  const path = req.path.toLowerCase();
  const requestedTenantId = String(req.headers['x-tenant-id'] || '').trim();
  if (requestedTenantId !== PUBLIC_DEMO_TENANT_ID) {
    res.status(403).json({
      success: false,
      error: { code: 'DEMO_TENANT_ONLY', message: 'The public demo session can only access its isolated demo workspace.', requestId: req.requestId },
    });
    return;
  }
  if (!UUID_PATTERN.test(payload.demoSessionId)) {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_DEMO_SESSION', message: 'The demo session is invalid. Please sign in again.', requestId: req.requestId },
    });
    return;
  }

  if (req.method === 'GET' && path === '/demo/usage') {
    try {
      const membership = await pool.query(
        `SELECT 1
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN tenants t ON t.id = m.tenant_id
         WHERE m.user_id = $1 AND u.email_normalized = $2
           AND m.tenant_id = $3 AND m.status = 'active'
           AND u.status = 'active' AND t.status = 'active'
           AND t.slug = 'public-demo'
         LIMIT 1`,
        [payload.userId, payload.email.trim().toLowerCase(), PUBLIC_DEMO_TENANT_ID],
      );
      if (membership.rowCount !== 1) {
        res.status(403).json({ success: false, error: { code: 'DEMO_MEMBERSHIP_REQUIRED', message: 'A valid demo workspace membership is required.', requestId: req.requestId } });
        return;
      }
      const usage = await pool.query<{ action_count: number }>(
        'SELECT action_count FROM demo_usage_sessions WHERE tenant_id = $1 AND session_id = $2 LIMIT 1',
        [PUBLIC_DEMO_TENANT_ID, payload.demoSessionId],
      );
      const used = Number(usage.rows[0]?.action_count || 0);
      res.json({ success: true, data: { limit: PUBLIC_DEMO_MAX_ACTIONS, used, remaining: Math.max(0, PUBLIC_DEMO_MAX_ACTIONS - used), simulatedOutbound: true }, meta: { requestId: req.requestId } });
    } catch (error) {
      console.error('[DemoQuota] Usage read failed', { requestId: req.requestId, error });
      res.status(503).json({ success: false, error: { code: 'DEMO_QUOTA_UNAVAILABLE', message: 'Demo usage is temporarily unavailable.', requestId: req.requestId } });
    }
    return;
  }

  // Only application screens needed for a limited guided trial are available.
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!READ_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'))) {
      res.status(403).json({
        success: false,
        error: { code: 'DEMO_FEATURE_RESTRICTED', message: 'This feature is available after signing in to a paid workspace.', requestId: req.requestId },
      });
      return;
    }
    res.locals.demoMode = true;
    return next();
  }

  // Demo supports safe lead/task experiments and one simulated WhatsApp action.
  const isAllowedMutation =
    (req.method === 'POST' && ['/leads', '/tasks', '/contacts', '/whatsapp/messages'].includes(path)) ||
    (['PATCH', 'PUT'].includes(req.method) && (/^\/leads\/[0-9a-f-]+$/i.test(path) || /^\/tasks\/[0-9a-f-]+$/i.test(path)));
  if (!isAllowedMutation) {
    res.status(403).json({
      success: false,
      error: { code: 'DEMO_FEATURE_RESTRICTED', message: 'This action is disabled in the public demo. Sign in to an authorised workspace to use it.', requestId: req.requestId },
    });
    return;
  }

  try {
    const membership = await pool.query(
      `SELECT 1
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = $1 AND u.email_normalized = $2
         AND m.tenant_id = $3 AND m.status = 'active'
         AND u.status = 'active' AND t.status = 'active'
         AND t.slug = 'public-demo'
       LIMIT 1`,
      [payload.userId, payload.email.trim().toLowerCase(), PUBLIC_DEMO_TENANT_ID],
    );
    if (membership.rowCount !== 1) {
      res.status(403).json({
        success: false,
        error: { code: 'DEMO_MEMBERSHIP_REQUIRED', message: 'A valid demo workspace membership is required.', requestId: req.requestId },
      });
      return;
    }

    const usage = await pool.query(
      `INSERT INTO demo_usage_sessions (tenant_id, session_id, action_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, session_id) DO UPDATE
         SET action_count = demo_usage_sessions.action_count + 1,
             updated_at = NOW()
         WHERE demo_usage_sessions.action_count < $3
       RETURNING action_count`,
      [PUBLIC_DEMO_TENANT_ID, payload.demoSessionId, PUBLIC_DEMO_MAX_ACTIONS],
    );

    if (usage.rowCount !== 1) {
      res.status(429).json({
        success: false,
        error: {
          code: 'DEMO_LIMIT_REACHED',
          message: 'You have used all 5 demo test actions for this session. Start a new demo session or sign in to a paid workspace.',
          limit: PUBLIC_DEMO_MAX_ACTIONS,
          used: PUBLIC_DEMO_MAX_ACTIONS,
          requestId: req.requestId,
        },
      });
      return;
    }

    res.locals.demoMode = true;
    res.setHeader('X-Demo-Actions-Limit', String(PUBLIC_DEMO_MAX_ACTIONS));
    res.setHeader('X-Demo-Actions-Used', String(usage.rows[0].action_count));
    next();
  } catch (error) {
    console.error('[DemoQuota] Could not enforce public-demo usage limit', { requestId: req.requestId, error });
    res.status(503).json({
      success: false,
      error: { code: 'DEMO_QUOTA_UNAVAILABLE', message: 'Demo access is temporarily unavailable. Please retry shortly.', requestId: req.requestId },
    });
  }
}
