import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool } from '../db';

const router = Router();

// Security/audit data is restricted to workspace administrators.
router.get('/', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const requested = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 250) : 100;

  try {
    const result = await pool.query(
      `SELECT
         e.id,
         e.tenant_id AS "tenantId",
         e.actor_user_id AS "actorUserId",
         COALESCE(u.display_name, u.email_normalized, 'System') AS actor,
         e.action,
         e.entity_type AS "entityType",
         e.entity_id AS "entityId",
         e.occurred_at AS "occurredAt",
         e.request_id AS "requestId",
         e.safe_metadata AS metadata
       FROM audit_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.tenant_id = $1
       ORDER BY e.occurred_at DESC
       LIMIT $2;`,
      [req.tenantContext!.tenantId, limit],
    );

    res.json({
      success: true,
      data: result.rows.map((row: any) => ({
        ...row,
        status: Number(row.metadata?.responseStatus || 200) < 400 ? 'SUCCESS' : 'FAILED',
        entity: `${row.entityType} · ${row.entityId}`,
        source: row.metadata?.method && row.metadata?.path
          ? `${row.metadata.method} ${row.metadata.path}`
          : 'API',
      })),
      meta: { totalCount: result.rows.length, limit, requestId },
    });
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || 'AUDIT_QUERY_FAILED')
      : 'AUDIT_QUERY_FAILED';
    console.error('[Audit API] Query failed', { requestId, errorCode });
    res.status(503).json({
      success: false,
      error: { code: 'AUDIT_UNAVAILABLE', message: 'Audit events could not be loaded from the database.', requestId },
    });
  }
});

export default router;
