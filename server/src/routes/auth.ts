import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { loginRateLimiter, passwordResetRateLimiter } from '../middleware/rateLimiter';
import { hashPassword, verifyPassword, signToken } from '../services/authService';
import { SessionContext, RoleName } from '../types';
import { pool, withTransaction } from '../db';
import { isPasswordResetDeliveryConfigured, sendPasswordResetEmail } from '../services/emailService';

const router = Router();

function shouldUseDatabaseAuth(): boolean {
  // Static users below are test-only fixtures. Every normal runtime must use persisted accounts.
  return process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
}

// Internal user record with bcrypt password hash
interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: 'active' | 'suspended';
  defaultTenantId: string;
}

type DatabaseAuthRecord = {
  user_id: string; email: string; display_name: string; password_hash: string | null;
  user_status: string; user_created_at: string | Date; tenant_id: string; tenant_name: string;
  tenant_slug: string; tenant_status: string; timezone: string; currency: string; locale: string;
  tenant_created_at: string | Date; tenant_updated_at: string | Date; role_name: string; permissions: string[];
};

async function findDatabaseAuthRecord(selector: { email?: string; userId?: string }): Promise<DatabaseAuthRecord | null> {
  const byEmail = typeof selector.email === 'string';
  const criterion = byEmail ? 'u.email_normalized = $1' : 'u.id = $1::uuid';
  const value = byEmail ? selector.email!.trim().toLowerCase() : selector.userId;
  const result = await pool.query<DatabaseAuthRecord>(`
    SELECT u.id::text AS user_id, u.email_normalized AS email, u.display_name,
           u.password_hash, u.status AS user_status, u.created_at AS user_created_at,
           u.session_version,
           t.id::text AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
           t.status AS tenant_status, t.timezone, t.currency, t.locale,
           t.created_at AS tenant_created_at, t.updated_at AS tenant_updated_at,
           r.name AS role_name,
           COALESCE(array_agg(DISTINCT rp.permission_key)
             FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
      FROM users u
      JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
      JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
      JOIN roles r ON r.id = m.role_id
 LEFT JOIN role_permissions rp ON rp.role_id = r.id
     WHERE ${criterion} AND u.status = 'active'
     GROUP BY u.id, t.id, r.id
     LIMIT 1
  `, [value]);
  return result.rows[0] || null;
}

function sessionFromDatabase(row: DatabaseAuthRecord): SessionContext {
  const safeDate = (value: string | Date): string => new Date(value).toISOString();
  const roleName: RoleName = ['Admin', 'Sales Manager', 'Sales Executive', 'Read-only'].includes(row.role_name)
    ? row.role_name as RoleName : 'Read-only';
  return {
    user: {
      id: row.user_id, email: row.email, displayName: row.display_name,
      status: row.user_status as 'active' | 'invited' | 'suspended',
      createdAt: safeDate(row.user_created_at),
    },
    tenant: {
      id: row.tenant_id, name: row.tenant_name, slug: row.tenant_slug,
      status: row.tenant_status as 'active' | 'suspended' | 'trial',
      timezone: row.timezone, currency: row.currency, locale: row.locale,
      createdAt: safeDate(row.tenant_created_at), updatedAt: safeDate(row.tenant_updated_at),
    },
    role: roleName,
    permissions: row.permissions || [],
  };
}


// Explicit test-only identity fixtures. They are unreachable outside NODE_ENV=test.
let INITIALIZED_USERS: UserAccount[] = [];

async function getInitializedUsers(): Promise<UserAccount[]> {
  if (INITIALIZED_USERS.length === 0) {
    const rohanHash = await hashPassword('Password123!');
    const riyaHash = await hashPassword('ManagerPass123!');
    INITIALIZED_USERS = [
      {
        id: 'user_rohan_singh',
        email: 'rohan@bringmybite.in',
        displayName: 'Rohan Singh',
        passwordHash: rohanHash,
        status: 'active',
        defaultTenantId: 'tenant_bring_my_bite',
      },
      {
        id: 'user_riya_singh',
        email: 'riya@bringmybite.in',
        displayName: 'Riya Singh',
        passwordHash: riyaHash,
        status: 'active',
        defaultTenantId: 'tenant_bring_my_bite',
      },
      {
        id: 'user_suspended_member',
        email: 'suspended@bringmybite.in',
        displayName: 'Suspended Member',
        passwordHash: await hashPassword('SuspendedPass123!'),
        status: 'suspended',
        defaultTenantId: 'tenant_bring_my_bite',
      },
    ];
  }
  return INITIALIZED_USERS;
}

// 1. Login with Rate Limiting and Cryptographic JWT Signing
router.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  const requestId = req.requestId || 'req_unknown';

  if (!email || !password) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required.',
        details: {
          email: !email ? ['Email is required.'] : [],
          password: !password ? ['Password is required.'] : [],
        },
        requestId,
      },
    });
    return;
  }

  if (shouldUseDatabaseAuth()) {
    if (!process.env.DATABASE_URL) {
      res.status(503).json({ success: false, error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Authentication storage is not configured.', requestId } });
      return;
    }
    try {
      const record = await findDatabaseAuthRecord({ email: String(email) });
      if (!record || !record.password_hash || !(await verifyPassword(String(password), record.password_hash))) {
        res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password combination.', requestId } });
        return;
      }
      const session = sessionFromDatabase(record);
      const token = signToken({ userId: record.user_id, email: record.email, defaultTenantId: record.tenant_id, sessionVersion: record.session_version });
      res.json({ success: true, data: { token, session }, meta: { requestId, serverTimestamp: new Date().toISOString() } });
      return;
    } catch {
      res.status(503).json({ success: false, error: { code: 'AUTHENTICATION_UNAVAILABLE', message: 'Authentication service is temporarily unavailable.', requestId } });
      return;
    }
  }

  const users = await getInitializedUsers();
  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find((u) => u.email.toLowerCase() === normalizedEmail);

  if (!user || user.status !== 'active') {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password combination.',
        requestId,
      },
    });
    return;
  }

  // Cryptographic constant-time bcrypt verification
  const isMatch = await verifyPassword(password, user.passwordHash);
  if (!isMatch) {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password combination.',
        requestId,
      },
    });
    return;
  }

  // Cryptographically sign JWT with user identity and 24h expiration
  const token = signToken({
    userId: user.id,
    email: user.email,
    defaultTenantId: user.defaultTenantId,
  });

  const session: SessionContext = {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: '2026-01-15T09:00:00Z',
    },
    tenant: {
      id: 'tenant_bring_my_bite',
      name: 'Bring My Bite',
      slug: 'bring-my-bite',
      status: 'active',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      locale: 'en-IN',
      createdAt: '2026-01-15T09:00:00Z',
      updatedAt: '2026-01-15T09:00:00Z',
    },
    role: user.id === 'user_rohan_singh' ? 'Admin' : 'Sales Manager',
    permissions: ['leads:read', 'leads:write', 'pipeline:manage', 'reports:view'],
  };

  res.json({
    success: true,
    data: {
      token,
      session,
    },
    meta: {
      requestId,
      serverTimestamp: new Date().toISOString(),
    },
  });
});

// 2. Verified Session Retrieval (Protected)
router.get('/session', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (shouldUseDatabaseAuth()) {
    try {
      const record = await findDatabaseAuthRecord({ userId: req.userId });
      if (!record) {
        res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Authenticated user session was not found.', requestId: req.requestId || 'req_unknown' } });
        return;
      }
      res.json({ success: true, data: sessionFromDatabase(record), meta: { requestId: req.requestId } });
      return;
    } catch {
      res.status(503).json({ success: false, error: { code: 'SESSION_UNAVAILABLE', message: 'Session service is temporarily unavailable.', requestId: req.requestId || 'req_unknown' } });
      return;
    }
  }

  const users = await getInitializedUsers();
  const user = users.find((u) => u.id === req.userId);

  if (!user) {
    res.status(401).json({
      success: false,
      error: {
        code: 'USER_NOT_FOUND',
        message: 'Authenticated user session was not found.',
        requestId: req.requestId || 'req_unknown',
      },
    });
    return;
  }

  const session: SessionContext = {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: '2026-01-15T09:00:00Z',
    },
    tenant: {
      id: 'tenant_bring_my_bite',
      name: 'Bring My Bite',
      slug: 'bring-my-bite',
      status: 'active',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      locale: 'en-IN',
      createdAt: '2026-01-15T09:00:00Z',
      updatedAt: '2026-01-15T09:00:00Z',
    },
    role: user.id === 'user_rohan_singh' ? 'Admin' : 'Sales Manager',
    permissions: ['leads:read', 'leads:write', 'pipeline:manage', 'reports:view'],
  };

  res.json({
    success: true,
    data: session,
    meta: {
      requestId: req.requestId,
    },
  });
});

// 3. Logout — revoke this token server-side instead of merely clearing the client.
router.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (shouldUseDatabaseAuth()) {
    if (!req.authTokenId || !req.authTokenExpiresAt || !req.userId) {
      res.status(401).json({ success: false, error: { code: 'INVALID_SESSION', message: 'The session cannot be revoked. Please sign in again.', requestId } });
      return;
    }
    try {
      await pool.query(
        `INSERT INTO revoked_auth_tokens (jti, user_id, expires_at)
         VALUES ($1, $2::uuid, to_timestamp($3))
         ON CONFLICT (jti) DO NOTHING`,
        [req.authTokenId, req.userId, req.authTokenExpiresAt]
      );
    } catch {
      res.status(503).json({ success: false, error: { code: 'LOGOUT_UNAVAILABLE', message: 'Sign-out could not be confirmed. Please retry.', requestId } });
      return;
    }
  }
  res.json({ success: true, data: { message: 'Successfully signed out.' }, meta: { requestId } });
});

// 4. Password recovery: one-time random tokens, SHA-256 hashes at rest, bounded TTL, and generic responses.
function validNewPassword(password: string): boolean {
  return password.length >= 12 && password.length <= 128
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

const passwordResetMessage = 'If the email is linked to an active account, a reset email will be attempted. Contact your workspace administrator if it does not arrive.';

router.post('/forgot-password', passwordResetRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address.', requestId } });
    return;
  }
  if (!shouldUseDatabaseAuth() || !isPasswordResetDeliveryConfigured()) {
    res.status(503).json({ success: false, error: { code: 'PASSWORD_RECOVERY_NOT_CONFIGURED', message: 'Password recovery requires configured database storage and email delivery.', requestId } });
    return;
  }

  try {
    const result = await pool.query<{ id: string; email: string; display_name: string }>(
      `SELECT id::text AS id, email_normalized AS email, display_name
         FROM users
        WHERE email_normalized = $1 AND status = 'active'
        LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (user) {
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const configuredTtl = Number.parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES || '15', 10);
      const ttlMinutes = Number.isInteger(configuredTtl) ? Math.min(60, Math.max(5, configuredTtl)) : 15;

      await withTransaction(async (client) => {
        await client.query(
          'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1::uuid AND used_at IS NULL',
          [user.id]
        );
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1::uuid, $2, NOW() + ($3::int * INTERVAL '1 minute'))`,
          [user.id, tokenHash, ttlMinutes]
        );
      });

      try {
        const resetUrl = new URL('/reset-password', process.env.APP_PUBLIC_URL);
        resetUrl.searchParams.set('token', rawToken);
        await sendPasswordResetEmail(email, user.display_name, resetUrl.toString());
      } catch (error) {
        // Keep account enumeration resistant. Invalidate a link that could not be delivered.
        await pool.query(
          'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1::uuid AND token_hash = $2 AND used_at IS NULL',
          [user.id, tokenHash]
        ).catch(() => undefined);
        console.error(`[Auth Recovery] Delivery failed for request ${requestId}.`, error instanceof Error ? error.message : 'Unknown mail provider error');
      }
    }

    // Same status/body for known and unknown accounts; this confirms acceptance, not delivery.
    res.status(202).json({ success: true, data: { message: passwordResetMessage }, meta: { requestId } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: 'Password recovery is temporarily unavailable. Please retry later.', requestId } });
  }
});

router.post('/reset-password', passwordResetRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (token.length < 32 || token.length > 256 || !validNewPassword(password)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Provide a valid recovery token and a password of at least 12 characters with upper/lowercase letters, a number, and a symbol.',
        requestId,
      },
    });
    return;
  }
  if (!shouldUseDatabaseAuth()) {
    res.status(503).json({ success: false, error: { code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: 'Password recovery is not enabled in test-fixture mode.', requestId } });
    return;
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const passwordHash = await hashPassword(password);
  try {
    const reset = await withTransaction(async (client) => {
      const tokenRow = await client.query<{ id: string; user_id: string }>(
        `SELECT prt.id::text AS id, prt.user_id::text AS user_id
           FROM password_reset_tokens prt
           JOIN users u ON u.id = prt.user_id AND u.status = 'active'
          WHERE prt.token_hash = $1 AND prt.used_at IS NULL AND prt.expires_at > NOW()
          FOR UPDATE OF prt, u`,
        [tokenHash]
      );
      const row = tokenRow.rows[0];
      if (!row) return false;

      const changed = await client.query(
        `UPDATE users
            SET password_hash = $1,
                password_changed_at = NOW(),
                session_version = session_version + 1,
                updated_at = NOW()
          WHERE id = $2::uuid AND status = 'active'`,
        [passwordHash, row.user_id]
      );
      if (changed.rowCount !== 1) return false;

      await client.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1::uuid AND used_at IS NULL',
        [row.user_id]
      );
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, request_id, safe_metadata)
         SELECT m.tenant_id, $1::uuid, 'password_reset', 'user', $1::uuid, $2, '{}'::jsonb
           FROM memberships m
          WHERE m.user_id = $1::uuid AND m.status = 'active'`,
        [row.user_id, requestId]
      );
      return true;
    });

    if (!reset) {
      res.status(400).json({ success: false, error: { code: 'RESET_TOKEN_INVALID', message: 'This reset link is invalid, expired, or already used. Request a new one.', requestId } });
      return;
    }
    res.json({ success: true, data: { message: 'Password changed. Please sign in again on your devices.' }, meta: { requestId } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'PASSWORD_RESET_UNAVAILABLE', message: 'Password reset is temporarily unavailable. Please retry later.', requestId } });
  }
});

export default router;
