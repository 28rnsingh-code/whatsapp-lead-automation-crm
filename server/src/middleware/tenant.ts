import { Request, Response, NextFunction } from 'express';
import { RoleName } from '../types';
import { pool, resolveDatabaseConfig } from '../db';

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

// In-memory verified membership directory for fallback and isolated test execution
interface MembershipRecord {
  tenantId: string;
  userId: string;
  role: RoleName;
  status: 'active' | 'suspended';
  permissions: string[];
}

const VERIFIED_MEMBERSHIPS: MembershipRecord[] = [
  {
    tenantId: 'tenant_bring_my_bite',
    userId: 'user_rohan_singh',
    role: 'Admin',
    status: 'active',
    permissions: ['leads:read', 'leads:write', 'leads:delete', 'pipeline:manage', 'reports:view', 'team:manage', 'settings:manage', 'audit:read', 'integrations:manage'],
  },
  {
    tenantId: 'tenant_automics_labs',
    userId: 'user_rohan_singh',
    role: 'Sales Executive',
    status: 'active',
    permissions: ['leads:read', 'leads:write'],
  },
  {
    tenantId: 'tenant_automics_labs',
    userId: 'user_other_tenant',
    role: 'Admin',
    status: 'active',
    permissions: ['leads:read', 'leads:write', 'leads:delete', 'pipeline:manage', 'reports:view', 'team:manage', 'settings:manage', 'audit:read', 'integrations:manage'],
  },
  {
    tenantId: 'tenant_bring_my_bite',
    userId: 'user_riya_singh',
    role: 'Sales Manager',
    status: 'active',
    permissions: ['leads:read', 'leads:write', 'pipeline:manage', 'reports:view'],
  },
  {
    tenantId: 'tenant_bring_my_bite',
    userId: 'user_suspended_member',
    role: 'Sales Executive',
    status: 'suspended',
    permissions: [],
  },
];

/**
 * Tenant Isolation & Membership Verification Middleware.
 * Critical Security Invariant:
 * 1. The client cannot dictate authorization via body or query params.
 * 2. The user must have a verified active membership record for the requested tenant.
 * 3. Cross-tenant or unauthorized requests are strictly rejected with 403.
 */
function requiredPermissionForRequest(req: Request): string | null {
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  if (path.startsWith('/api/leads')) {
    if (method === 'GET') return 'leads:read';
    if (method === 'POST') return 'leads:write';
    if (method === 'DELETE') return 'leads:delete';
    if (method === 'PATCH' || method === 'PUT') return 'leads:write';
  }
  if (path.startsWith('/api/contacts') || path.startsWith('/api/tasks')) {
    if (method === 'GET') return 'leads:read';
    if (method === 'DELETE') return 'leads:delete';
    if (['POST', 'PATCH', 'PUT'].includes(method)) return 'leads:write';
  }
  if (path.startsWith('/api/pipeline')) return method === 'GET' ? 'leads:read' : 'pipeline:manage';
  if (path.startsWith('/api/reports') || path.startsWith('/api/dashboard')) return 'reports:view';
  if (path.startsWith('/api/audit')) return 'audit:read';
  if (path.startsWith('/api/team')) return method === 'GET' ? 'team:manage' : 'team:manage';
  if (path.startsWith('/api/workspaces')) return method === 'GET' ? 'leads:read' : 'team:manage';
  if (path.startsWith('/api/integrations')) return 'integrations:manage';
  if (path.startsWith('/api/whatsapp')) {
    if (path.includes('/messages')) return method === 'GET' ? 'leads:read' : 'leads:write';
    return 'integrations:manage';
  }
  if (path.startsWith('/api/ai')) return 'settings:manage';
  if (path.startsWith('/api/billing')) return 'settings:manage';
  if (path.startsWith('/api/import')) return method === 'GET' ? 'leads:read' : 'leads:write';
  if (path.startsWith('/api/export')) return 'leads:read';
  return null;
}

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

    // Workspace selection must be explicit. Never silently default an identity to a tenant.
    const rawTenantHeader = req.headers['x-tenant-id'];
    if (typeof rawTenantHeader !== 'string' || !rawTenantHeader.trim()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'WORKSPACE_REQUIRED',
          message: 'Select a workspace before accessing workspace resources.',
          requestId,
        },
      });
      return;
    }
    const targetTenantId = rawTenantHeader.trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const testFixtureMode = process.env.NODE_ENV === 'test' && resolveDatabaseConfig().isBlocked;

    // Friendly/demo tenant slugs are accepted only by isolated, database-blocked tests.
    // Normal development and production require the real persistent tenant UUID.
    if (!testFixtureMode && !uuidPattern.test(targetTenantId)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_ACCESS_DENIED',
          message: 'The requested workspace identifier is invalid.',
          requestId,
        },
      });
      return;
    }

    let membership: { role: RoleName; status: string; permissions: string[] } | null = null;

    if (testFixtureMode) {
      // Fixtures are deliberately limited to the blocked-database test path.
      const match = VERIFIED_MEMBERSHIPS.find(
        (candidate) => candidate.tenantId === targetTenantId && candidate.userId === req.userId
      );
      if (match) {
        membership = {
          role: match.role,
          status: match.status,
          permissions: match.permissions,
        };
      }
    } else {
      // Persistent membership lookup is mandatory for every non-fixture runtime.
      // Database failures deny access with 503; they never trigger an in-memory fallback.
      try {
        const result = await pool.query<{ role_name: string; status: string; permissions: string[] }>(
          `SELECT r.name AS role_name,
                  m.status,
                  COALESCE(array_agg(DISTINCT rp.permission_key)
                    FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
             FROM memberships m
             JOIN roles r ON r.id = m.role_id
             JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
             JOIN users u ON u.id = m.user_id AND u.status = 'active'
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
            WHERE m.tenant_id = $1::uuid AND m.user_id = $2::uuid
            GROUP BY r.name, m.status
            LIMIT 1`,
          [targetTenantId, req.userId]
        );
        const row = result.rows[0];
        if (row) {
          membership = {
            role: row.role_name as RoleName,
            status: row.status,
            permissions: row.permissions || [],
          };
        }
      } catch {
        res.status(503).json({
          success: false,
          error: {
            code: 'TENANT_AUTHORIZATION_UNAVAILABLE',
            message: 'Workspace authorization could not be verified. Please retry shortly.',
            requestId,
          },
        });
        return;
      }
    }

    // No membership or a suspended membership is never permissively authorized.
    if (!membership) {
      res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_ACCESS_DENIED',
          message: 'You are not an active member of this workspace.',
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

    // 7. Enforce server-side permissions for the protected resource and HTTP method.
    const requiredPermission = requiredPermissionForRequest(req);
    if (requiredPermission && !membership.permissions.includes(requiredPermission)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Your workspace role does not permit this action.',
          details: { requiredPermission },
          requestId,
        },
      });
      return;
    }

    // 8. Attach validated tenant context to the request
    req.tenantContext = {
      tenantId: targetTenantId,
      role: membership.role,
      permissions: membership.permissions,
    };

    next();
  };
}
