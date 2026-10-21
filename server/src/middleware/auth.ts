import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

/**
 * Authentication Middleware.
 * Cryptographically verifies signed JWT Bearer tokens and extracts authenticated identity.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
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

  try {
    const decoded = verifyToken(token);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    return next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
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
}
