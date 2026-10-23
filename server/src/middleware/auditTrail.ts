import { Request, Response, NextFunction } from 'express';
import { pool, resolveDatabaseConfig } from '../db';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records successful authenticated tenant-scoped mutations without copying request
 * bodies, patient/lead contents, credentials, or query strings into the audit table.
 * The event write is deliberately best-effort after the business response; audit
 * failure is observable in server logs but must never rewrite a completed response.
 */
export function auditTrailMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  res.once('finish', () => {
    const tenantId = req.tenantContext?.tenantId;
    const actorUserId = req.userId;
    if (!tenantId || !actorUserId || !UUID_PATTERN.test(tenantId) || !UUID_PATTERN.test(actorUserId)) return;
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    if (resolveDatabaseConfig().isBlocked) return;

    const safePath = req.originalUrl.split('?')[0].slice(0, 500);
    const pathParts = safePath.split('/').filter(Boolean);
    const entityType = (pathParts[1] || 'api').slice(0, 50);
    const method = req.method.toUpperCase();
    const actionPrefix = method === 'POST' ? 'CREATE'
      : method === 'DELETE' ? 'DELETE'
      : method === 'PUT' || method === 'PATCH' ? 'UPDATE'
      : 'MUTATE';
    const paramId = req.params?.id || req.params?.leadId;
    const entityId = typeof paramId === 'string' && UUID_PATTERN.test(paramId) ? paramId : null;
    const requestId = req.requestId || null;
    const metadata = {
      method,
      path: safePath,
      responseStatus: res.statusCode,
    };

    void pool.query(
      `INSERT INTO audit_events
        (tenant_id, actor_user_id, action, entity_type, entity_id, occurred_at, request_id, safe_metadata)
       VALUES ($1, $2, $3, $4, COALESCE($5::uuid, gen_random_uuid()), NOW(), $6, $7::jsonb);`,
      [tenantId, actorUserId, `${actionPrefix}_${entityType.toUpperCase()}`.slice(0, 100), entityType, entityId, requestId, JSON.stringify(metadata)],
    ).catch((error) => {
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || 'AUDIT_WRITE_FAILED')
        : 'AUDIT_WRITE_FAILED';
      console.error('[Audit Trail] Event persistence failed', { requestId, errorCode, entityType, actionPrefix });
    });
  });

  next();
}
