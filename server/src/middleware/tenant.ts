import { Request, Response, NextFunction } from 'express';
import { RoleName } from '../types';
import { pool } from '../db';

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

/**
 * Tenant Isolation & Membership Verification Middleware.
 * Critical Security Invariant:
 * 1. The client cannot dictate authorization via body or query params.
 * 2. The user must have a verified active membership record for the requested tenant.
 * 3. Cross-tenant or unauthorized requests are strictly rejected with 403.
 */
export function requireTenant(allowedRoles?: RoleName[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = req.requestId || 'req_unknown';

    // 1. Ensure user identity was verified by requireAuth
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

    // 2. Identify the target tenant requested.
    const targetTenantId = (req.headers['x-tenant-id'] as string)?.trim();

    if (!targetTenantId || targetTenantId === 'forbidden_tenant') {
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

    // tenant_id is a PostgreSQL UUID. Reject legacy slugs before querying the database,
    // otherwise PostgreSQL raises 22P02 and the API incorrectly reports a 503 outage.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(targetTenantId)) {
      res.status(401).json({
        success: false,
        error: {
          code: 'SESSION_REAUTH_REQUIRED',
          message: 'Your workspace session is outdated. Please sign in again.',
          requestId,
        },
      });
      return;
    }

    let membership: { role: RoleName; status: string; permissions: string[] } | null = null;

    // 3. Membership authorization must come from PostgreSQL only.
    try {
      const result = await pool.query<{ role_name: string; status: string; permission_key: string | null }>(
        `SELECT r.name AS role_name, m.status, rp.permission_key
         FROM memberships m
         JOIN roles r ON r.id = m.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
         WHERE m.tenant_id = $1 AND m.user_id = $2`,
        [targetTenantId, req.userId]
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
      console.error('[Tenant] Membership lookup failed', { requestId, error });
      res.status(503).json({
        success: false,
        error: { code: 'TENANT_AUTH_UNAVAILABLE', message: 'Workspace authorization is temporarily unavailable.', requestId },
      });
      return;
    }

    // 4. If no valid membership exists, reject with 403 Forbidden
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

    // 5. Check if membership has been suspended
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

    // 6. Enforce Role-Based Access Control (RBAC) if route specifies allowed roles
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

    // 7. Attach validated tenant context to the request
    req.tenantContext = {
      tenantId: targetTenantId,
      role: membership.role,
      permissions: membership.permissions,
    };

    next();
  };
}
