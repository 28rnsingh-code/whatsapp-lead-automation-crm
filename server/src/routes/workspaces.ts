import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { Tenant } from '../types';
import { pool } from '../db';

const router = Router();

function shouldUseDatabaseMemberships(): boolean {
  return process.env.NODE_ENV === 'production'
    || (Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true');
}

// Development-only workspace fixtures. Production always reads memberships from PostgreSQL.
const WORKSPACES: Tenant[] = [
  {
    id: 'tenant_bring_my_bite',
    name: 'Bring My Bite',
    slug: 'bring-my-bite',
    status: 'active',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    locale: 'en-IN',
    createdAt: '2026-01-15T09:00:00Z',
    updatedAt: '2026-01-15T09:00:00Z',
  },
  {
    id: 'tenant_automics_labs',
    name: 'Automics Labs',
    slug: 'automics-labs',
    status: 'active',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    locale: 'en-IN',
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-01T10:00:00Z',
  },
];

const DB_WORKSPACE_SELECT = `
  SELECT t.id::text AS id, t.name, t.slug, t.status, t.timezone, t.currency, t.locale,
         t.created_at AS "createdAt", t.updated_at AS "updatedAt", r.name AS role
    FROM tenants t
    JOIN memberships m ON m.tenant_id = t.id
    JOIN roles r ON r.id = m.role_id
   WHERE m.user_id = $1::uuid AND m.status = 'active' AND t.status = 'active'
`;

function dbWorkspaceToTenant(row: any): Tenant & { role?: string } {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as Tenant['status'],
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    role: row.role,
  };
}

// List only the authenticated user's workspaces.
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (shouldUseDatabaseMemberships()) {
    try {
      const result = await pool.query(
        `${DB_WORKSPACE_SELECT} ORDER BY t.created_at ASC;`,
        [req.userId]
      );
      res.json({
        success: true,
        data: result.rows.map(dbWorkspaceToTenant),
        meta: { totalCount: result.rows.length, requestId: req.requestId },
      });
    } catch {
      res.status(503).json({
        success: false,
        error: {
          code: 'WORKSPACES_UNAVAILABLE',
          message: 'Workspace directory is temporarily unavailable.',
          requestId: req.requestId || 'req_unknown',
        },
      });
    }
    return;
  }

  res.json({
    success: true,
    data: WORKSPACES,
    meta: { totalCount: WORKSPACES.length, requestId: req.requestId },
  });
});

// Get the active workspace after requireTenant has checked membership.
router.get('/current', requireAuth, requireTenant(), async (req: Request, res: Response): Promise<void> => {
  if (shouldUseDatabaseMemberships()) {
    try {
      const result = await pool.query(
        `${DB_WORKSPACE_SELECT}
          AND t.id = $2::uuid
          LIMIT 1;`,
        [req.userId, req.tenantContext!.tenantId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'The active workspace was not found.',
            requestId: req.requestId || 'req_unknown',
          },
        });
        return;
      }
      res.json({ success: true, data: dbWorkspaceToTenant(result.rows[0]), meta: { requestId: req.requestId } });
    } catch {
      res.status(503).json({
        success: false,
        error: {
          code: 'WORKSPACE_UNAVAILABLE',
          message: 'Workspace details are temporarily unavailable.',
          requestId: req.requestId || 'req_unknown',
        },
      });
    }
    return;
  }

  const currentTenant = WORKSPACES.find((w) => w.id === req.tenantContext?.tenantId) || WORKSPACES[0];
  res.json({ success: true, data: currentTenant, meta: { requestId: req.requestId } });
});

export default router;
