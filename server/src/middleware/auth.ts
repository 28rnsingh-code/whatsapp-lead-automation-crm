import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';
import { pool, resolveDatabaseConfig } from '../db';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      authTokenId?: string;
      authTokenExpiresAt?: number;
    }
  }
}

/**
 * Authentication middleware.
 * Verifies JWT cryptography, then checks live account status, session version, and
 * server-side revocation. Test fixtures are allowed only when tests are deliberately
 * running with the database safety guard blocking all database access.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const requestId = req.requestId || 'req_unknown';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication credentials (Bearer token) are required.',
        requestId,
      },
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Empty authentication token provided.',
        requestId,
      },
    });
    return;
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (error: any) {
    if (error?.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Your session has expired. Please sign in again.',
          requestId,
        },
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Supplied authentication token is invalid or has an untrusted signature.',
        requestId,
      },
    });
    return;
  }

  const testFixtureMode = process.env.NODE_ENV === 'test' && resolveDatabaseConfig().isBlocked;
  if (!testFixtureMode) {
    if (!decoded.jti || !Number.isInteger(decoded.sessionVersion)) {
      res.status(401).json({
        success: false,
        error: {
          code: 'SESSION_REAUTHENTICATION_REQUIRED',
          message: 'Your session needs to be refreshed. Please sign in again.',
          requestId,
        },
      });
      return;
    }

    try {
      const account = await pool.query<{
        status: string;
        session_version: number;
        token_revoked: boolean;
      }>(
        `SELECT u.status,
                u.session_version,
                EXISTS (
                  SELECT 1 FROM revoked_auth_tokens rt
                   WHERE rt.jti = $2 AND rt.expires_at > NOW()
                ) AS token_revoked
           FROM users u
          WHERE u.id = $1::uuid
          LIMIT 1`,
        [decoded.userId, decoded.jti]
      );
      const row = account.rows[0];
      if (!row || row.status !== 'active') {
        res.status(401).json({
          success: false,
          error: {
            code: 'ACCOUNT_INACTIVE',
            message: 'This account is unavailable. Contact your workspace administrator.',
            requestId,
          },
        });
        return;
      }
      if (row.token_revoked || row.session_version !== decoded.sessionVersion) {
        res.status(401).json({
          success: false,
          error: {
            code: 'SESSION_REVOKED',
            message: 'This session is no longer valid. Please sign in again.',
            requestId,
          },
        });
        return;
      }
    } catch {
      res.status(503).json({
        success: false,
        error: {
          code: 'AUTHORIZATION_UNAVAILABLE',
          message: 'Account authorization could not be verified. Please retry shortly.',
          requestId,
        },
      });
      return;
    }
  }

  req.userId = decoded.userId;
  req.userEmail = decoded.email;
  req.authTokenId = decoded.jti;
  req.authTokenExpiresAt = decoded.exp;
  next();
}
