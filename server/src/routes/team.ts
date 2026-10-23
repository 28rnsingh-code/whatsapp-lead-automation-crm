import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { pool } from '../db';
import { hashPassword } from '../services/authService';
import { PLAN_DEFINITIONS, PlanTier } from '../services/billing/types';
import { RoleName } from '../types';

const router = Router();
const ALLOWED_ROLES: RoleName[] = ['Admin', 'Sales Manager', 'Sales Executive', 'Read-only'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, status: number, code: string, message: string, requestId: string): void {
  res.status(status).json({ success: false, error: { code, message, requestId } });
}

function requestId(req: Request): string {
  return req.requestId || 'req_unknown';
}

async function ensureRole(tenantId: string, roleName: RoleName, client: any): Promise<string> {
  const found = await client.query(
    'SELECT id FROM roles WHERE tenant_id = $1 AND name = $2 LIMIT 1',
    [tenantId, roleName],
  );
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await client.query(
    'INSERT INTO roles (tenant_id, name, description, is_system) VALUES ($1, $2, $3, TRUE) RETURNING id',
    [tenantId, roleName, `Workspace role: ${roleName}`],
  );
  return inserted.rows[0].id;
}

async function maxMembersForTenant(client: any, tenantId: string): Promise<{ maxMembers: number; planId: string }> {
  const result = await client.query<{ plan_id: string; limits: any }>(
    'SELECT plan_id, limits FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1',
    [tenantId],
  );
  const row = result.rows[0];
  const planId = row?.plan_id && row.plan_id in PLAN_DEFINITIONS ? row.plan_id : 'starter';
  const limits = typeof row?.limits === 'string' ? JSON.parse(row.limits) : row?.limits;
  const configured = Number(limits?.maxMembers);
  return {
    maxMembers: Number.isInteger(configured) && configured > 0 ? configured : PLAN_DEFINITIONS[planId as PlanTier].limits.maxMembers,
    planId,
  };
}

/** Member list is backed by the current tenant's persisted membership records. */
router.get('/members', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantContext!.tenantId;
  try {
    const [members, plan] = await Promise.all([
      pool.query(
        `SELECT m.id AS "membershipId", u.id AS "userId", u.display_name AS "displayName",
                u.email_normalized AS email, r.name AS role, m.status AS "membershipStatus",
                u.status AS "accountStatus", m.invited_at AS "invitedAt",
                m.accepted_at AS "acceptedAt", u.must_change_password AS "mustChangePassword",
                (SELECT COUNT(*)::int FROM leads l
                 WHERE l.tenant_id = m.tenant_id AND l.owner_user_id = u.id) AS "leadsAssigned"
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN roles r ON r.id = m.role_id
         WHERE m.tenant_id = $1
         ORDER BY CASE WHEN r.name = 'Admin' THEN 0 ELSE 1 END, u.display_name ASC`,
        [tenantId],
      ),
      pool.query('SELECT plan_id, limits FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1', [tenantId]),
    ]);
    const storedLimits = plan.rows[0]?.limits;
    const limits = typeof storedLimits === 'string' ? JSON.parse(storedLimits) : storedLimits;
    const planId = plan.rows[0]?.plan_id in PLAN_DEFINITIONS ? plan.rows[0].plan_id as PlanTier : 'starter';
    const maxMembers = Number(limits?.maxMembers) || PLAN_DEFINITIONS[planId].limits.maxMembers;
    res.json({
      success: true,
      data: members.rows,
      meta: { requestId: requestId(req), totalCount: members.rows.length, maxMembers, planId, remainingSeats: Math.max(0, maxMembers - members.rows.filter((m: any) => m.membershipStatus === 'active' && m.accountStatus === 'active').length) },
    });
  } catch (error) {
    console.error('[Team] Member listing failed', { requestId: requestId(req), error });
    fail(res, 503, 'TEAM_UNAVAILABLE', 'Workspace team information is temporarily unavailable.', requestId(req));
  }
});

/**
 * Create an account/membership under the active tenant. A temporary password is returned
 * once for an Admin to pass to the member; the member must change it immediately.
 * This route does not pretend an email was sent. Existing global accounts keep their password.
 */
router.post('/members', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantContext!.tenantId;
  const adminUserId = req.userId!;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const role = typeof req.body?.role === 'string' ? req.body.role as RoleName : 'Sales Executive';
  const id = requestId(req);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(res, 400, 'INVALID_EMAIL', 'Enter a valid member email address.', id);
    return;
  }
  if (!ALLOWED_ROLES.includes(role)) {
    fail(res, 400, 'INVALID_ROLE', 'Choose a supported workspace role.', id);
    return;
  }

  const generatedPassword = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
  const passwordHash = await hashPassword(generatedPassword);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise seat checks for this workspace to avoid two concurrent invites taking the last seat.
    const tenantLock = await client.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (!tenantLock.rowCount) {
      await client.query('ROLLBACK');
      fail(res, 404, 'WORKSPACE_NOT_FOUND', 'Active workspace was not found.', id);
      return;
    }

    const { maxMembers, planId } = await maxMembersForTenant(client, tenantId);
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = $1 AND m.status IN ('active', 'invited')
         AND u.status = 'active'`,
      [tenantId],
    );
    const currentMembers = Number(countResult.rows[0]?.count || 0);
    if (currentMembers >= maxMembers) {
      await client.query('ROLLBACK');
      res.status(409).json({
        success: false,
        error: { code: 'PLAN_SEAT_LIMIT_REACHED', message: `Your ${planId} plan allows ${maxMembers} team members. Upgrade the plan or remove an existing member.`, requestId: id, maxMembers, planId },
      });
      return;
    }

    const existing = await client.query<{ id: string; password_hash: string | null; must_change_password: boolean }>(
      'SELECT id, password_hash, must_change_password FROM users WHERE email_normalized = $1 LIMIT 1',
      [email],
    );
    let userId: string;
    let temporaryPassword: string | undefined;
    let createdNewAccount = false;

    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      const alreadyMember = await client.query(
        'SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2 LIMIT 1',
        [tenantId, userId],
      );
      if (alreadyMember.rowCount) {
        await client.query('ROLLBACK');
        fail(res, 409, 'MEMBER_ALREADY_EXISTS', 'This email already belongs to this workspace.', id);
        return;
      }
      if (!existing.rows[0].password_hash) {
        await client.query('ROLLBACK');
        fail(res, 409, 'ACCOUNT_NEEDS_INVITATION_FLOW', 'An account for this email exists but has no password. A verified email-invitation flow is required.', id);
        return;
      }
    } else {
      const insertedUser = await client.query<{ id: string }>(
        `INSERT INTO users (email_normalized, display_name, password_hash, status, must_change_password)
         VALUES ($1, $2, $3, 'active', TRUE) RETURNING id`,
        [email, displayName || email.split('@')[0], passwordHash],
      );
      userId = insertedUser.rows[0].id;
      temporaryPassword = generatedPassword;
      createdNewAccount = true;
    }

    const roleId = await ensureRole(tenantId, role, client);
    const membership = await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role_id, status, invited_by, invited_at, accepted_at)
       VALUES ($1, $2, $3, 'active', $4, NOW(), CASE WHEN $5 THEN NULL ELSE NOW() END)
       RETURNING id`,
      [tenantId, userId, roleId, adminUserId, createdNewAccount],
    );
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: {
        membershipId: membership.rows[0].id,
        userId,
        email,
        displayName: displayName || email.split('@')[0],
        role,
        membershipStatus: 'active',
        mustChangePassword: createdNewAccount,
        temporaryPassword,
        passwordDelivery: createdNewAccount ? 'show-once-admin-shares-securely' : 'existing-account-no-email-sent',
        createdNewAccount,
      },
      meta: { requestId: id, planId, maxMembers, currentMembers: currentMembers + 1 },
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23505') {
      fail(res, 409, 'MEMBER_CONFLICT', 'That email address is already registered. Refresh the member list and try again.', id);
      return;
    }
    console.error('[Team] Member creation failed', { requestId: id, error });
    fail(res, 503, 'TEAM_CREATE_FAILED', 'The member could not be created. No invitation email was sent.', id);
  } finally {
    client.release();
  }
});

router.patch('/members/:userId/role', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantContext!.tenantId;
  const userId = req.params.userId;
  const role = typeof req.body?.role === 'string' ? req.body.role as RoleName : '';
  const id = requestId(req);
  if (!UUID_PATTERN.test(userId) || !ALLOWED_ROLES.includes(role)) {
    fail(res, 400, 'INVALID_MEMBER_ROLE', 'A valid member UUID and role are required.', id);
    return;
  }
  if (userId === req.userId && role !== 'Admin') {
    fail(res, 409, 'CANNOT_DEMOTE_SELF', 'You cannot remove your own Admin access.', id);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query<{ id: string; role: string }>(
      `SELECT m.id, r.name AS role FROM memberships m
       JOIN roles r ON r.id = m.role_id
       WHERE m.tenant_id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
      [tenantId, userId],
    );
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      fail(res, 404, 'MEMBER_NOT_FOUND', 'Member was not found in this workspace.', id);
      return;
    }
    if (target.rows[0].role === 'Admin' && role !== 'Admin') {
      const adminCount = await client.query(
        `SELECT COUNT(*)::int AS count FROM memberships m
         JOIN roles r ON r.id = m.role_id
         WHERE m.tenant_id = $1 AND m.status = 'active' AND r.name = 'Admin'`,
        [tenantId],
      );
      if (Number(adminCount.rows[0]?.count || 0) <= 1) {
        await client.query('ROLLBACK');
        fail(res, 409, 'LAST_ADMIN_REQUIRED', 'At least one active Admin must remain in the workspace.', id);
        return;
      }
    }
    const roleId = await ensureRole(tenantId, role, client);
    await client.query('UPDATE memberships SET role_id = $1 WHERE tenant_id = $2 AND user_id = $3', [roleId, tenantId, userId]);
    await client.query('COMMIT');
    res.json({ success: true, data: { userId, role }, meta: { requestId: id } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[Team] Role update failed', { requestId: id, error });
    fail(res, 503, 'TEAM_ROLE_UPDATE_FAILED', 'The member role could not be updated.', id);
  } finally {
    client.release();
  }
});

router.patch('/members/:userId/status', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenantContext!.tenantId;
  const userId = req.params.userId;
  const status = req.body?.status;
  const id = requestId(req);
  if (!UUID_PATTERN.test(userId) || !['active', 'suspended'].includes(status)) {
    fail(res, 400, 'INVALID_MEMBER_STATUS', 'Status must be active or suspended.', id);
    return;
  }
  if (userId === req.userId) {
    fail(res, 409, 'CANNOT_CHANGE_SELF_STATUS', 'You cannot suspend your own workspace membership.', id);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query<{ role: string }>(
      `SELECT r.name AS role FROM memberships m JOIN roles r ON r.id = m.role_id
       WHERE m.tenant_id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
      [tenantId, userId],
    );
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      fail(res, 404, 'MEMBER_NOT_FOUND', 'Member was not found in this workspace.', id);
      return;
    }
    if (target.rows[0].role === 'Admin' && status === 'suspended') {
      const admins = await client.query(
        `SELECT COUNT(*)::int AS count FROM memberships m JOIN roles r ON r.id = m.role_id
         WHERE m.tenant_id = $1 AND m.status = 'active' AND r.name = 'Admin'`,
        [tenantId],
      );
      if (Number(admins.rows[0]?.count || 0) <= 1) {
        await client.query('ROLLBACK');
        fail(res, 409, 'LAST_ADMIN_REQUIRED', 'At least one active Admin must remain in the workspace.', id);
        return;
      }
    }
    await client.query('UPDATE memberships SET status = $1 WHERE tenant_id = $2 AND user_id = $3', [status, tenantId, userId]);
    await client.query('COMMIT');
    res.json({ success: true, data: { userId, membershipStatus: status }, meta: { requestId: id } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[Team] Member status update failed', { requestId: id, error });
    fail(res, 503, 'TEAM_MEMBER_STATUS_FAILED', 'The member status could not be updated.', id);
  } finally {
    client.release();
  }
});

export default router;
