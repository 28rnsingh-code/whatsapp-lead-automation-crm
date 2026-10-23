import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool, resolveDatabaseConfig } from '../db';

const router = Router();

function sendWorkspaceUnavailable(res: Response, requestId: string, code = 'DATABASE_UNAVAILABLE'): void {
  res.status(503).json({
    success: false,
    error: { code, message: 'Workspace information is unavailable until the database connection is healthy.', requestId },
  });
}

/** Return only the authenticated account's active, persisted workspace memberships. */
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const email = req.userEmail?.trim().toLowerCase();
  if (!email) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authenticated account identity is unavailable.', requestId },
    });
    return;
  }

  if (resolveDatabaseConfig().isBlocked) {
    sendWorkspaceUnavailable(res, requestId, 'DATABASE_CONFIGURATION_INVALID');
    return;
  }

  try {
    const result = await pool.query(
      `SELECT
         t.id, t.name, t.slug, t.status, t.timezone, t.currency, t.locale,
         t.created_at AS "createdAt", t.updated_at AS "updatedAt",
         r.name AS role
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN tenants t ON t.id = m.tenant_id
       JOIN roles r ON r.id = m.role_id
       WHERE u.email_normalized = $1
         AND u.status = 'active'
         AND m.status = 'active'
         AND t.status IN ('active', 'trial')
       ORDER BY t.created_at ASC, t.name ASC;`,
      [email],
    );
    res.json({ success: true, data: result.rows, meta: { totalCount: result.rows.length, requestId } });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[Workspaces] Membership listing failed', { requestId, errorCode });
    sendWorkspaceUnavailable(res, requestId);
  }
});

/** Resolve the current workspace only after requireTenant validates membership. */
router.get('/current', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (resolveDatabaseConfig().isBlocked) {
    sendWorkspaceUnavailable(res, requestId, 'DATABASE_CONFIGURATION_INVALID');
    return;
  }

  try {
    const result = await pool.query(
      `SELECT
         t.id, t.name, t.slug, t.status, t.timezone, t.currency, t.locale,
         t.created_at AS "createdAt", t.updated_at AS "updatedAt",
         r.name AS role
       FROM tenants t
       JOIN memberships m ON m.tenant_id = t.id
       JOIN roles r ON r.id = m.role_id
       WHERE t.id = $1
         AND m.user_id = $2
         AND m.status = 'active'
         AND t.status IN ('active', 'trial')
       LIMIT 1;`,
      [req.tenantContext!.tenantId, req.userId],
    );

    if (!result.rows.length) {
      res.status(403).json({
        success: false,
        error: { code: 'TENANT_ACCESS_DENIED', message: 'You are not an active member of this workspace.', requestId },
      });
      return;
    }
    res.json({ success: true, data: result.rows[0], meta: { requestId } });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'DATABASE_UNAVAILABLE')
      : 'DATABASE_UNAVAILABLE';
    console.error('[Workspaces] Current workspace lookup failed', { requestId, errorCode });
    sendWorkspaceUnavailable(res, requestId);
  }
});

export default router;
