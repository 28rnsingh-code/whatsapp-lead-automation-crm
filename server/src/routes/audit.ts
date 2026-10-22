import { Router, Request, Response } from 'express';
import { pool, resolveDatabaseConfig } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';

const router = Router();
function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value === undefined ? '' : value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
function csvCell(value: unknown): string {
  let text = String(value === undefined || value === null ? '' : value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
async function getEvents(tenantId: string, limit: number, offset: number) {
  const sql = 'SELECT a.id::text AS id, a.action AS action, a.entity_type AS "entityType", a.entity_id::text AS "entityId", a.occurred_at AS "occurredAt", a.request_id AS "requestId", a.safe_metadata AS metadata, COALESCE(u.display_name, u.email_normalized, \'Workspace user\') AS actor ' +
    'FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.tenant_id = $1::uuid ORDER BY a.occurred_at DESC, a.id DESC LIMIT $2 OFFSET $3;';
  return pool.query(sql, [tenantId, limit, offset]);
}
router.get('/events', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  const page = clampInteger(req.query.page, 1, 1, 1000000);
  const pageSize = clampInteger(req.query.pageSize, 25, 1, 100);
  if (resolveDatabaseConfig().isBlocked) {
    res.json({ success: true, data: { events: [], totalCount: 0, page: page, pageSize: pageSize, demoMode: true }, meta: { requestId: requestId } });
    return;
  }
  try {
    const tenantId = req.tenantContext!.tenantId;
    const results = await Promise.all([
      getEvents(tenantId, pageSize, (page - 1) * pageSize),
      pool.query('SELECT COUNT(*)::text AS "totalCount" FROM audit_events WHERE tenant_id = $1::uuid;', [tenantId])
    ]);
    res.json({ success: true, data: { events: results[0].rows, totalCount: Number(results[1].rows[0].totalCount || 0), page: page, pageSize: pageSize, demoMode: false }, meta: { requestId: requestId } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'AUDIT_UNAVAILABLE', message: 'Audit history is temporarily unavailable.', requestId: requestId } });
  }
});
router.get('/export', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (resolveDatabaseConfig().isBlocked) {
    res.status(503).json({ success: false, error: { code: 'AUDIT_UNAVAILABLE', message: 'Persistent audit history is not available in demo mode.', requestId: requestId } });
    return;
  }
  try {
    const result = await getEvents(req.tenantContext!.tenantId, 10000, 0);
    const header = ['Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity ID', 'Request ID', 'Metadata'];
    const rows = result.rows.map((event: any) => [event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt, event.actor, event.action, event.entityType, event.entityId, event.requestId, JSON.stringify(event.metadata || {})]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="oneclick-audit-trail.csv"');
    res.send(csv);
  } catch {
    res.status(503).json({ success: false, error: { code: 'AUDIT_UNAVAILABLE', message: 'Audit export is temporarily unavailable.', requestId: requestId } });
  }
});
export default router;
