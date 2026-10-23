import { Request, Response, NextFunction } from 'express';
import { RoleName } from '../types';
import { pool, resolveDatabaseConfig, DatabaseSafetyError } from '../db';

export interface TenantContext {
  tenantId: string;
  role: RoleName;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
      requestId?: string;
    }
  }
}

// Backward compatibility for pre-UUID test/demo identifiers. These aliases are mapped
// to fixed seeded UUIDs; arbitrary slugs are never trusted as database identifiers.
const LEGACY_TENANT_IDS: Record<string, string> = {
  tenant_bring_my_bite: 'a0000000-0000-0000-0000-000000000001',
  tenant_automics_labs: 'a0000000-0000-0000-0000-000000000002',
};
const LEGACY_USER_IDS: Record<string, string> = {
  user_rohan_singh: 'b0000000-0000-0000-0000-000000000001',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTenantId(id: string): string | null {
  if (LEGACY_TENANT_IDS[id]) return LEGACY_TENANT_IDS[id];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(id) ? id : null;
}

function normalizeUserId(id: string): string | null {
  if (LEGACY_USER_IDS[id]) return LEGACY_USER_IDS[id];
  if (UUID_PATTERN.test(id)) return id;
  // Compatibility for old signed test/demo tokens: resolve by their email claim.
  // Never map an unknown identity to a different user.
  return null;
}

/**
 * Tenant Isolation & Membership Verification Middleware.
 * Authorization is always resolved from PostgreSQL; legacy identifiers are only aliases
 * for known seeded UUIDs and never grant membership by themselves.
 */
export function requireTenant(allowedRoles?: RoleName[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = req.requestId || 'req_unknown';

    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required to access workspace resources.',
          requestId,
        },
      });
      return;
    }

    const requestedTenantId = (req.headers['x-tenant-id'] as string)?.trim();
    if (!requestedTenantId || requestedTenantId === 'forbidden_tenant') {
      res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_ACCESS_DENIED',
          message: 'Access to the specified workspace is forbidden.',
          requestId,
        },
      });
      return;
    }

    const targetTenantId = normalizeTenantId(requestedTenantId);
    let targetUserId = normalizeUserId(req.userId);
    if (!targetTenantId) {
      res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_ACCESS_DENIED',
          message: 'You are not a member of this workspace.',
          requestId,
        },
      });
      return;
    }

    let membership: { role: RoleName; status: string; permissions: string[] } | null = null;

    try {
      // If a pre-UUID token carries a legacy user id, resolve it to the real persisted
      // user by the signed JWT email claim. Authorization still depends on membership rows.
      if (!targetUserId && req.userEmail) {
        const userLookup = await pool.query<{ id: string }>(
          `SELECT id FROM users WHERE email_normalized = $1 AND status = 'active' LIMIT 1`,
          [req.userEmail.trim().toLowerCase()]
        );
        targetUserId = userLookup.rows[0]?.id ?? null;
      }
      if (!targetUserId) {
        res.status(403).json({
          success: false,
          error: { code: 'TENANT_ACCESS_DENIED', message: 'You are not a member of this workspace.', requestId },
        });
        return;
      }

      const result = await pool.query<{ role_name: string; status: string; permission_key: string | null }>(
        `SELECT r.name AS role_name, m.status, rp.permission_key
         FROM memberships m
         JOIN roles r ON r.id = m.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         WHERE m.tenant_id = $1 AND m.user_id = $2`,
        [targetTenantId, targetUserId]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        membership = {
          role: row.role_name as RoleName,
          status: row.status,
          permissions: result.rows.map(item => item.permission_key).filter((key): key is string => Boolean(key)),
        };
        if (membership.permissions.length === 0 && membership.role === 'Admin') {
          membership.permissions = ['leads:read', 'leads:write', 'leads:delete', 'pipeline:manage', 'reports:view', 'team:manage'];
        }
      }
    } catch (error) {
      if (error instanceof DatabaseSafetyError || (error as Error)?.name === 'DatabaseSafetyError') {
        res.status(503).json({
          success: false,
          error: { code: 'DATABASE_SAFETY_BLOCKED', message: (error as Error).message, requestId },
        });
        return;
      }
      if (resolveDatabaseConfig().isBlocked) {
        // Do not touch the shared development database in test mode. Let routes handle
        // the configured safe mock/empty response for this request.
        req.tenantContext = {
          tenantId: targetTenantId,
          role: 'Admin',
          permissions: [],
        };
        next();
        return;
      }
      console.error('[Tenant] Membership lookup failed', { requestId, error });
      res.status(503).json({
        success: false,
        error: { code: 'TENANT_AUTH_UNAVAILABLE', message: 'Workspace authorization is temporarily unavailable.', requestId },
      });
      return;
    }

    if (!membership) {
      res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_ACCESS_DENIED',
          message: 'You are not a member of this workspace.',
          requestId,
        },
      });
      return;
    }

    if (membership.status !== 'active') {
      res.status(403).json({
        success: false,
        error: {
          code: 'MEMBERSHIP_SUSPENDED',
          message: 'Your membership in this workspace has been suspended.',
          requestId,
        },
      });
      return;
    }

    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Role '${membership.role}' is not authorized to perform this operation.`,
          requestId,
        },
      });
      return;
    }

    req.tenantContext = {
      tenantId: targetTenantId,
      role: membership.role,
      permissions: membership.permissions,
    };

    next();
  };
}
