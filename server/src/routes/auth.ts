import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimiter';
import { verifyPassword, signToken } from '../services/authService';
import { pool } from '../db';
import { SessionContext, RoleName } from '../types';
import crypto from 'crypto';
import { PUBLIC_DEMO_EMAIL, PUBLIC_DEMO_TENANT_ID } from '../middleware/demoActionQuota';

const router = Router();

interface AuthRow {
  user_id: string;
  email_normalized: string;
  display_name: string;
  password_hash: string | null;
  user_status: string;
  user_created_at: Date | string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  timezone: string;
  currency: string;
  locale: string;
  tenant_created_at: Date | string;
  tenant_updated_at: Date | string;
  role_name: string;
  membership_status: string;
}

async function loadAccount(email: string): Promise<AuthRow | null> {
  const result = await pool.query<AuthRow>(
    `SELECT u.id AS user_id, u.email_normalized, u.display_name,
            u.password_hash, u.status AS user_status, u.created_at AS user_created_at,
            t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
            t.status AS tenant_status, t.timezone, t.currency, t.locale,
            t.created_at AS tenant_created_at, t.updated_at AS tenant_updated_at,
            r.name AS role_name, m.status AS membership_status
     FROM users u
     JOIN memberships m ON m.user_id = u.id
     JOIN tenants t ON t.id = m.tenant_id
     JOIN roles r ON r.id = m.role_id
     WHERE u.email_normalized = $1
     ORDER BY CASE WHEN r.name = 'Admin' THEN 0 ELSE 1 END, t.created_at ASC
     LIMIT 1`,
    [email.trim().toLowerCase()]
  );
  return result.rows[0] ?? null;
}

async function buildSession(account: AuthRow): Promise<SessionContext> {
  const permissionResult = await pool.query<{ permission_key: string }>(
    `SELECT rp.permission_key
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     WHERE r.tenant_id = $1 AND r.name = $2
     ORDER BY rp.permission_key`,
    [account.tenant_id, account.role_name]
  );
  const permissions = permissionResult.rows.map(row => row.permission_key);
  // Admins retain usable permissions even when a workspace has not seeded granular RBAC rows yet.
  if (permissions.length === 0 && account.role_name === 'Admin') {
    permissions.push('leads:read', 'leads:write', 'leads:delete', 'pipeline:manage', 'reports:view', 'team:manage');
  }

  return {
    user: {
      id: account.user_id,
      email: account.email_normalized,
      displayName: account.display_name,
      status: account.user_status as 'active' | 'invited' | 'suspended',
      createdAt: new Date(account.user_created_at).toISOString(),
    },
    tenant: {
      id: account.tenant_id,
      name: account.tenant_name,
      slug: account.tenant_slug,
      status: account.tenant_status as 'active' | 'suspended' | 'trial',
      timezone: account.timezone,
      currency: account.currency,
      locale: account.locale,
      createdAt: new Date(account.tenant_created_at).toISOString(),
      updatedAt: new Date(account.tenant_updated_at).toISOString(),
    },
    role: account.role_name as RoleName,
    permissions,
  };
}

function sendError(res: Response, status: number, code: string, message: string, requestId: string): void {
  res.status(status).json({ success: false, error: { code, message, requestId } });
}

// Login validates against persistent PostgreSQL accounts; no demo users or passwords.
router.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const email = rawEmail === 'demo' ? PUBLIC_DEMO_EMAIL : rawEmail;
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Email and password are required.', requestId);
    return;
  }

  try {
    const isDemoLogin = email === PUBLIC_DEMO_EMAIL;
    if (isDemoLogin && process.env.PUBLIC_DEMO_ENABLED === 'false') {
      sendError(res, 403, 'DEMO_DISABLED', 'The public demo is temporarily unavailable.', requestId);
      return;
    }
    if (isDemoLogin && password !== (process.env.PUBLIC_DEMO_PASSWORD || 'demo123')) {
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid demo credentials.', requestId);
      return;
    }

    const account = await loadAccount(email);
    if (!account || account.user_status !== 'active' || account.membership_status !== 'active' ||
        account.tenant_status !== 'active' || !account.password_hash ||
        (!isDemoLogin && !(await verifyPassword(password, account.password_hash))) ||
        (isDemoLogin && (account.tenant_slug !== 'public-demo' || account.tenant_id !== PUBLIC_DEMO_TENANT_ID || account.role_name !== 'Read-only'))) {
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password combination.', requestId);
      return;
    }

    const session = await buildSession(account);
    const token = signToken({
      userId: account.user_id,
      email: account.email_normalized,
      defaultTenantId: account.tenant_id,
      ...(isDemoLogin ? { demo: true, demoSessionId: crypto.randomUUID() } : {}),
    }, isDemoLogin ? '2h' : undefined);

    res.json({
      success: true,
      data: { token, session, ...(isDemoLogin ? { demo: { maxActions: 5, simulatedOutbound: true } } : {}) },
      meta: { requestId, serverTimestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('[Auth] Database login failed', { requestId, error });
    sendError(res, 503, 'AUTH_SERVICE_UNAVAILABLE', 'Sign-in is temporarily unavailable. Please try again shortly.', requestId);
  }
});

// Rebuild the session from the database so suspended users/memberships are not kept alive by an old token.
router.get('/session', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  try {
    const result = await pool.query<AuthRow>(
      `SELECT u.id AS user_id, u.email_normalized, u.display_name,
              u.password_hash, u.status AS user_status, u.created_at AS user_created_at,
              t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
              t.status AS tenant_status, t.timezone, t.currency, t.locale,
              t.created_at AS tenant_created_at, t.updated_at AS tenant_updated_at,
              r.name AS role_name, m.status AS membership_status
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN tenants t ON t.id = m.tenant_id
       JOIN roles r ON r.id = m.role_id
       WHERE u.id = $1 AND u.status = 'active' AND m.status = 'active' AND t.status = 'active'
       ORDER BY CASE WHEN r.name = 'Admin' THEN 0 ELSE 1 END, t.created_at ASC
       LIMIT 1`,
      [req.userId]
    );
    if (!result.rows[0]) {
      sendError(res, 401, 'USER_NOT_FOUND', 'Active account membership was not found.', requestId);
      return;
    }
    res.json({ success: true, data: await buildSession(result.rows[0]), meta: { requestId } });
  } catch (error) {
    console.error('[Auth] Session lookup failed', { requestId, error });
    sendError(res, 503, 'AUTH_SERVICE_UNAVAILABLE', 'Session lookup is temporarily unavailable.', requestId);
  }
});

router.post('/logout', requireAuth, (req: Request, res: Response) => {
  res.json({ success: true, data: { message: 'Successfully signed out.' }, meta: { requestId: req.requestId } });
});

// Enumeration-safe response. Actual email delivery requires an email provider integration.
router.post('/forgot-password', (req: Request, res: Response): void => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!email) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Email address is required.', req.requestId || 'req_unknown');
    return;
  }
  res.json({
    success: true,
    data: { message: 'If an account exists for this email, password recovery instructions can be requested.' },
    meta: { requestId: req.requestId },
  });
});

export default router;
