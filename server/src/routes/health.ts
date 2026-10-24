import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

// Liveness: confirms the API process can respond to HTTP requests.
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      service: 'oneclick-automics-crm-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
    meta: { requestId: req.requestId },
  });
});

// Readiness: confirms the database dependency can execute a query.
router.get('/ready', async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  try {
    await pool.query('SELECT 1');
    res.json({
      success: true,
      data: { status: 'ready', checks: { database: 'healthy' } },
      meta: { requestId, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[Health] Database readiness check failed', { requestId, errorCode });
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'The API is running but its database dependency is not ready.',
        requestId,
      },
    });
  }
});

export default router;
