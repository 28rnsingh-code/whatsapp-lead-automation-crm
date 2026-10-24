import { Request, Response, NextFunction } from 'express';
import { pool, resolveDatabaseConfig } from '../db';

function productionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

/**
 * Prevent production APIs from pretending an operation succeeded by serving
 * process-local demo arrays when PostgreSQL is unavailable. Health routes are
 * mounted before this middleware: /health stays a liveness probe and /ready
 * remains the explicit readiness probe.
 *
 * Local/test mode intentionally keeps existing isolated fixtures and test-only
 * fallback behaviour. Production must be persistent or return 503.
 */
export async function requireProductionDatabaseReady(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!productionRuntime() || req.method === 'OPTIONS') {
    next();
    return;
  }

  const requestId = req.requestId || 'req_unknown';
  const config = resolveDatabaseConfig();
  if (config.isBlocked) {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_CONFIGURATION_INVALID',
        message: 'The API cannot serve this request because its production database configuration is invalid.',
        requestId,
      },
    });
    return;
  }

  try {
    await pool.query('SELECT 1');
    next();
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[Database Readiness] Production request blocked', { requestId, errorCode });
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The persistent database is temporarily unavailable. No operation was accepted.',
        requestId,
      },
    });
  }
}
