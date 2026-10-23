import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';
import { pool } from '../db';

const DEMO_TENANT_ID = 'a0000000-0000-0000-0000-000000000003';
const MAX_DEMO_ACTIONS = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Enforces an atomic, server-side cap on write actions for public demo sessions.
 * Normal paid workspaces are unaffected. Session identity is a signed JWT claim,
 * not a client-supplied counter. Demo writes never grant access to other tenants.
 */
export async function demoActionQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const path = req.path.toLowerCase();
  if (
    path === '/auth/login' ||
    path === '/auth/forgot-password' ||
    path === '/auth/reset-password' ||
    path === '/whatsapp/webhook' ||
    path === '/billing/webhook'
  ) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  let payload;
  try {
    payload = verifyToken(header.slice(7).trim());
  } catch {
    return next(); // The route's standard auth middleware returns the appropriate 401.
  }

  if (!payload.demoSessionId) return next();

  const requestedTenantId = String(req.headers['x-tenant-id'] || '').trim();
  if (requestedTenantId !== DEMO_TENANT_ID) {
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
      [payload.userId, payload.email.trim().toLowerCase(), DEMO_TENANT_ID],
    );
    if (membership.rowCount !== 1) {
      res.status(403).json({
        success: false,
        error: { code: 'DEMO_MEMBERSHIP_REQUIRED', message: 'A valid demo workspace membership is required.', requestId: req.requestId },
      });
      return;
    }

    // This upsert atomically reserves one of the five write actions, even under concurrent requests.
    const usage = await pool.query(
      `INSERT INTO demo_usage_sessions (tenant_id, session_id, action_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, session_id) DO UPDATE
         SET action_count = demo_usage_sessions.action_count + 1,
             updated_at = NOW()
         WHERE demo_usage_sessions.action_count < $3
       RETURNING action_count`,
      [DEMO_TENANT_ID, payload.demoSessionId, MAX_DEMO_ACTIONS],
    );

    if (usage.rowCount !== 1) {
      res.status(429).json({
        success: false,
        error: {
          code: 'DEMO_LIMIT_REACHED',
          message: 'You have used all 5 demo test actions for this session. Sign in to a paid workspace to continue.',
          limit: MAX_DEMO_ACTIONS,
          used: MAX_DEMO_ACTIONS,
          requestId: req.requestId,
        },
      });
      return;
    }

    res.setHeader('X-Demo-Actions-Limit', String(MAX_DEMO_ACTIONS));
    res.setHeader('X-Demo-Actions-Used', String(usage.rows[0].action_count));
    next();
  } catch (error) {
    // Fail closed for signed demo sessions: do not silently bypass quotas if storage is unavailable.
    console.error('[DemoQuota] Could not enforce public-demo usage limit', { requestId: req.requestId, error });
    res.status(503).json({
      success: false,
      error: { code: 'DEMO_QUOTA_UNAVAILABLE', message: 'Demo access is temporarily unavailable. Please retry shortly.', requestId: req.requestId },
    });
  }
}
