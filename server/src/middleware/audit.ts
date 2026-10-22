import { Request, Response, NextFunction } from 'express';
import { pool, resolveDatabaseConfig } from '../db';

function isUuid(value?: string): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function findEntityId(body: any, params: Record<string, string>, tenantId: string): string {
  const candidates = [params.id, body && body.data && body.data.id, body && body.data && body.data.leadId, body && body.data && body.data.taskId, body && body.data && body.data.contactId, body && body.data && body.data.membershipId, body && body.data && body.data.invitationId, body && body.data && body.data.jobId];
  return candidates.find((candidate) => isUuid(candidate)) || tenantId;
}
export function auditMutationMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { next(); return; }
  let responseBody: any;
  const originalJson = res.json.bind(res);
  (res as any).json = (body: any) => { responseBody = body; return originalJson(body); };
  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const tenantId = req.tenantContext && req.tenantContext.tenantId;
    const actorUserId = req.userId;
    if (!isUuid(tenantId) || !isUuid(actorUserId) || resolveDatabaseConfig().isBlocked) return;
    const path = req.originalUrl.split('?')[0];
    const segments = path.split('/').filter(Boolean);
    const entityType = (segments[1] || 'workspace').slice(0, 50);
    const action = (req.method + '_' + entityType.toUpperCase()).slice(0, 100);
    const entityId = findEntityId(responseBody, req.params || {}, tenantId);
    const metadata = { method: req.method, path: path.slice(0, 250), responseStatus: res.statusCode, userAgent: (req.get('user-agent') || '').slice(0, 250) };
    void pool.query('INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, occurred_at, request_id, safe_metadata) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, NOW(), $6, $7::jsonb);', [tenantId, actorUserId, action, entityType, entityId, req.requestId || 'req_unknown', JSON.stringify(metadata)]).catch(() => {
      console.warn('[Audit] Failed to persist mutation audit event', { requestId: req.requestId || 'req_unknown' });
    });
  });
  next();
}
