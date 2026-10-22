import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimiter';
import { hashPassword, verifyPassword, signToken } from '../services/authService';
import { SessionContext, RoleName } from '../types';
import { pool } from '../db';

const router = Router();

function shouldUseDatabaseAuth(): boolean {
  return process.env.NODE_ENV === 'production'
    || (Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true');
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


// In-memory user store with real bcrypt password hashes
// Default credentials for dev/test:
// Email: rohan@bringmybite.in | Password: Password123!
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
      const token = signToken({ userId: record.user_id, email: record.email, defaultTenantId: record.tenant_id });
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

// 3. Logout
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: { message: 'Successfully signed out.' },
    meta: {
      requestId: req.requestId,
    },
  });
});

// 4. Forgot Password (Safe Enumeration-Free Response)
router.post('/forgot-password', (req: Request, res: Response): void => {
  const { email } = req.body;
  if (shouldUseDatabaseAuth()) {
    res.status(501).json({ success: false, error: { code: 'PASSWORD_RECOVERY_NOT_CONFIGURED', message: 'Password recovery is not configured. Contact your workspace administrator.', requestId: req.requestId || 'req_unknown' } });
    return;
  }
  if (!email) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Email address is required.',
        requestId: req.requestId || 'req_unknown',
      },
    });
    return;
  }

  // Security invariant: never leak user account existence
  res.json({
    success: true,
    data: {
      message: 'If an account exists for this email, password recovery instructions have been dispatched.',
    },
    meta: {
      requestId: req.requestId,
    },
  });
});

export default router;
