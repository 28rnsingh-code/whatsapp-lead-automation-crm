import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimiter';
import { hashPassword, verifyPassword, signToken } from '../services/authService';
import { SessionContext } from '../types';

const router = Router();

// Internal user record with bcrypt password hash
interface UserAccount {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: 'active' | 'suspended';
  defaultTenantId: string;
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
