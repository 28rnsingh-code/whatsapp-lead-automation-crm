import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';

/**
 * New workspace members receive a one-time temporary password from an Admin.
 * Until they choose their own password, only session inspection, password change,
 * logout, and the login/recovery endpoints are allowed.
 */
export function requirePasswordChangeCompletion(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  let payload;
  try {
    payload = verifyToken(header.slice(7).trim());
  } catch {
    return next(); // Standard route authentication reports invalid tokens.
  }

  if (payload.mustChangePassword !== true) return next();
  const path = req.path.toLowerCase();
  const allowed = [
    '/auth/login',
    '/auth/session',
    '/auth/change-password',
    '/auth/logout',
    '/auth/forgot-password',
    '/auth/reset-password',
  ];
  if (allowed.includes(path)) return next();

  res.status(403).json({
    success: false,
    error: {
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Change your temporary password before using workspace features.',
      requestId: req.requestId,
      action: '/auth/change-password',
    },
  });
}
