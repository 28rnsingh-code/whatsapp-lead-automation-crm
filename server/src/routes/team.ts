import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { PoolClient } from 'pg';
import { pool, withTransaction, resolveDatabaseConfig } from '../db';
import { requireAuth } from '../middleware/auth';
import { requireTenant } from '../middleware/tenant';
import { RoleName } from '../types';
import { hashPassword } from '../services/authService';

const router = Router();
const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  Admin: ['leads:read','leads:write','leads:delete','pipeline:manage','reports:view','team:manage','settings:manage','audit:read','integrations:manage'],
  'Sales Manager': ['leads:read','leads:write','pipeline:manage','reports:view'],
  'Sales Executive': ['leads:read','leads:write'],
  'Read-only': ['leads:read','reports:view'],
};
const ROLE_NAMES = Object.keys(ROLE_PERMISSIONS) as RoleName[];
const inviteLimiter = rateLimit({ windowMs: 60000, limit: 12, standardHeaders: true, legacyHeaders: false });
const DEMO_MEMBERS = [{ membershipId: 'demo-member', userId: 'demo-user', name: 'Demo Admin', email: 'admin@example.test', role: 'Admin', status: 'active', leadsAssigned: 0 }];
const available = () => !resolveDatabaseConfig().isBlocked;
function error(res: Response, status: number, code: string, message: string, requestId: string) {
  res.status(status).json({ success: false, error: { code, message, requestId } });
}
function dbUnavailable(res: Response, requestId: string) {
  error(res, 503, 'DATABASE_UNAVAILABLE', 'A persistent database is required for team and invitation management.', requestId);
}
function parseRole(value: unknown): RoleName | null {
  return typeof value === 'string' && ROLE_NAMES.includes(value as RoleName) ? value as RoleName : null;
}
async function ensureRole(client: PoolClient, tenantId: string, role: RoleName): Promise<string> {
  let found = await client.query('SELECT id::text AS id FROM roles WHERE tenant_id = $1::uuid AND name = $2 LIMIT 1;', [tenantId, role]);
  let roleId: string;
  if (found.rows.length) roleId = found.rows[0].id;
  else {
    found = await client.query('INSERT INTO roles (tenant_id, name, description, is_system) VALUES ($1::uuid, $2, $3, false) RETURNING id::text AS id;', [tenantId, role, 'Workspace role: ' + role]);
    roleId = found.rows[0].id;
  }
  for (const permission of ROLE_PERMISSIONS[role]) {
    await client.query('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1::uuid, $2) ON CONFLICT (role_id, permission_key) DO NOTHING;', [roleId, permission]);
  }
  return roleId;
}
function makeInviteUrl(token: string): string {
  const origin = process.env.FRONTEND_URL || (process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).find(Boolean) || 'http://localhost:3000';
  try { const url = new URL('/', origin); url.searchParams.set('invite', token); return url.toString(); }
  catch { return 'http://localhost:3000/?invite=' + encodeURIComponent(token); }
}

router.get('/members', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (!available()) {
    res.json({ success: true, data: { members: DEMO_MEMBERS, demoMode: true }, meta: { totalCount: DEMO_MEMBERS.length, requestId } });
    return;
  }
  try {
    const result = await pool.query(
      'SELECT m.id::text AS "membershipId", u.id::text AS "userId", u.display_name AS name, u.email_normalized AS email, r.name AS role, CASE WHEN m.status = $2 OR u.status = $2 THEN $2 WHEN m.status = $3 AND u.status = $3 THEN $3 ELSE $4 END AS status, COUNT(l.id)::int AS "leadsAssigned" FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id LEFT JOIN leads l ON l.owner_user_id = u.id AND l.tenant_id = m.tenant_id AND l.archived_at IS NULL WHERE m.tenant_id = $1::uuid GROUP BY m.id, u.id, r.id ORDER BY u.display_name ASC, u.email_normalized ASC;',
      [req.tenantContext!.tenantId, 'suspended', 'active', 'invited']
    );
    res.json({ success: true, data: { members: result.rows, demoMode: false }, meta: { totalCount: result.rows.length, requestId } });
  } catch { dbUnavailable(res, requestId); }
});

router.post('/invitations', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (!available()) { dbUnavailable(res, requestId); return; }
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
  const role = parseRole(req.body.role);
  if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error(res, 400, 'VALIDATION_ERROR', 'Enter a valid work email address.', requestId); return; }
  if (displayName.length > 255) { error(res, 400, 'VALIDATION_ERROR', 'Display name must be 255 characters or fewer.', requestId); return; }
  if (!role) { error(res, 400, 'VALIDATION_ERROR', 'Select a supported workspace role.', requestId); return; }

  const tenantId = req.tenantContext!.tenantId;
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const name = displayName || email.split('@')[0];
  try {
    const created = await withTransaction(async (client) => {
      const tenant = await client.query('SELECT id FROM tenants WHERE id = $1::uuid AND status = $2 LIMIT 1;', [tenantId, 'active']);
      if (!tenant.rows.length) throw Object.assign(new Error('Workspace was not found.'), { statusCode: 404, errorCode: 'WORKSPACE_NOT_FOUND' });
      let userRows = await client.query('SELECT id::text AS id, status FROM users WHERE email_normalized = $1 LIMIT 1 FOR UPDATE;', [email]);
      if (!userRows.rows.length) userRows = await client.query('INSERT INTO users (email_normalized, display_name, status) VALUES ($1, $2, $3) RETURNING id::text AS id, status;', [email, name, 'invited']);
      const user = userRows.rows[0];
      if (user.status === 'suspended') throw Object.assign(new Error('This user is suspended.'), { statusCode: 409, errorCode: 'USER_SUSPENDED' });
      const membership = await client.query('SELECT id::text AS id, status FROM memberships WHERE tenant_id = $1::uuid AND user_id = $2::uuid LIMIT 1 FOR UPDATE;', [tenantId, user.id]);
      if (membership.rows[0] && membership.rows[0].status === 'active') throw Object.assign(new Error('This user is already an active member.'), { statusCode: 409, errorCode: 'MEMBER_EXISTS' });
      const roleId = await ensureRole(client, tenantId, role);
      let membershipId: string;
      if (membership.rows.length) {
        const changed = await client.query('UPDATE memberships SET role_id = $3::uuid, status = $4, invited_by = $5::uuid, invited_at = NOW(), accepted_at = NULL WHERE tenant_id = $1::uuid AND user_id = $2::uuid RETURNING id::text AS id;', [tenantId, user.id, roleId, 'invited', req.userId]);
        membershipId = changed.rows[0].id;
      } else {
        const made = await client.query('INSERT INTO memberships (tenant_id, user_id, role_id, status, invited_by, invited_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, NOW()) RETURNING id::text AS id;', [tenantId, user.id, roleId, 'invited', req.userId]);
        membershipId = made.rows[0].id;
      }
      await client.query('UPDATE workspace_invitations SET revoked_at = NOW() WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND accepted_at IS NULL AND revoked_at IS NULL;', [tenantId, user.id]);
      const invite = await client.query('INSERT INTO workspace_invitations (tenant_id, user_id, role_id, token_hash, invited_by, expires_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, NOW() + INTERVAL \'7 days\') RETURNING id::text AS id, expires_at;', [tenantId, user.id, roleId, tokenHash, req.userId]);
      return { membershipId: membershipId, invitationId: invite.rows[0].id, expiresAt: invite.rows[0].expires_at };
    });
    res.status(201).json({ success: true, data: { invitationId: created.invitationId, membershipId: created.membershipId, email: email, displayName: name, role: role, status: 'invited', inviteUrl: makeInviteUrl(token), expiresAt: created.expiresAt, emailSent: false, message: 'Invitation created. Email sending is not configured; copy and share this one-time link privately. It expires in 7 days.' }, meta: { requestId } });
  } catch (err: any) {
    if (err && err.statusCode) { error(res, err.statusCode, err.errorCode || 'INVITATION_ERROR', err.message, requestId); return; }
    dbUnavailable(res, requestId);
  }
});

router.patch('/members/:id', requireAuth, requireTenant(['Admin']), async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (!available()) { dbUnavailable(res, requestId); return; }
  const id = req.params.id;
  const tenantId = req.tenantContext!.tenantId;
  const role = req.body.role === undefined ? null : parseRole(req.body.role);
  const status = req.body.status;
  if (req.body.role !== undefined && !role) { error(res, 400, 'VALIDATION_ERROR', 'Select a supported workspace role.', requestId); return; }
  if (status !== undefined && status !== 'active' && status !== 'suspended') { error(res, 400, 'VALIDATION_ERROR', 'Member status must be active or suspended.', requestId); return; }
  if (role === null && status === undefined) { error(res, 400, 'VALIDATION_ERROR', 'At least one change is required.', requestId); return; }
  try {
    const current = await pool.query('SELECT m.user_id::text AS user_id, u.status AS user_status, u.password_hash, r.name AS role FROM memberships m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id WHERE m.id = $1::uuid AND m.tenant_id = $2::uuid LIMIT 1;', [id, tenantId]);
    if (!current.rows.length) { error(res, 404, 'MEMBER_NOT_FOUND', 'Member was not found in this workspace.', requestId); return; }
    if (status === 'suspended' && current.rows[0].user_id === req.userId) { error(res, 400, 'SELF_SUSPENSION_BLOCKED', 'You cannot suspend your own access.', requestId); return; }
    if (status === 'active' && (!current.rows[0].password_hash || current.rows[0].user_status !== 'active')) { error(res, 409, 'INVITATION_NOT_ACCEPTED', 'The invitee must accept the invitation before activation.', requestId); return; }
    let roleId: string | null = null;
    if (role) roleId = await withTransaction((client) => ensureRole(client, tenantId, role));
    const saved = await pool.query('UPDATE memberships SET role_id = COALESCE($3::uuid, role_id), status = COALESCE($4, status), accepted_at = CASE WHEN $4 = $5 THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING id::text AS "membershipId", status;', [id, tenantId, roleId, status || null, 'active']);
    res.json({ success: true, data: { ...saved.rows[0], role: role || current.rows[0].role }, meta: { requestId } });
  } catch { dbUnavailable(res, requestId); }
});

router.post('/invitations/accept', inviteLimiter, async (req: Request, res: Response): Promise<void> => {
  const requestId = req.requestId || 'req_unknown';
  if (!available()) { dbUnavailable(res, requestId); return; }
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[a-f0-9]{64}$/i.test(token)) { error(res, 400, 'INVALID_INVITATION', 'Invitation token is invalid or expired.', requestId); return; }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const loaded = await pool.query('SELECT wi.id::text AS id, wi.tenant_id::text AS tenant_id, wi.user_id::text AS user_id, wi.role_id::text AS role_id, u.email_normalized AS email, u.status AS user_status, u.password_hash, t.name AS workspace_name FROM workspace_invitations wi JOIN users u ON u.id = wi.user_id JOIN tenants t ON t.id = wi.tenant_id WHERE wi.token_hash = $1 AND wi.accepted_at IS NULL AND wi.revoked_at IS NULL AND wi.expires_at > NOW() LIMIT 1;', [tokenHash]);
    if (!loaded.rows.length) { error(res, 410, 'INVITATION_INVALID', 'Invitation is invalid, expired, or already used.', requestId); return; }
    const invitation = loaded.rows[0];
    if (invitation.user_status === 'suspended') { error(res, 403, 'ACCOUNT_SUSPENDED', 'This account is suspended.', requestId); return; }
    let passwordHash: string | null = null;
    if (!invitation.password_hash) {
      if (password.length < 12) { error(res, 400, 'PASSWORD_REQUIRED', 'New accounts must set a unique password of at least 12 characters.', requestId); return; }
      passwordHash = await hashPassword(password);
    }
    const accepted = await withTransaction(async (client) => {
      const locked = await client.query('SELECT wi.id::text AS id FROM workspace_invitations wi JOIN users u ON u.id = wi.user_id WHERE wi.id = $1::uuid AND wi.token_hash = $2 AND wi.accepted_at IS NULL AND wi.revoked_at IS NULL AND wi.expires_at > NOW() FOR UPDATE OF wi, u;', [invitation.id, tokenHash]);
      if (!locked.rows.length) throw Object.assign(new Error('Invitation is invalid, expired, or already used.'), { statusCode: 410, errorCode: 'INVITATION_INVALID' });
      await client.query('UPDATE users SET status = $2, password_hash = COALESCE(password_hash, $3) WHERE id = $1::uuid;', [invitation.user_id, 'active', passwordHash]);
      const member = await client.query('UPDATE memberships SET status = $4, accepted_at = NOW() WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND role_id = $3::uuid RETURNING id::text AS id;', [invitation.tenant_id, invitation.user_id, invitation.role_id, 'active']);
      if (!member.rows.length) throw Object.assign(new Error('The membership no longer exists.'), { statusCode: 409, errorCode: 'MEMBERSHIP_NOT_FOUND' });
      await client.query('UPDATE workspace_invitations SET accepted_at = NOW() WHERE id = $1::uuid;', [invitation.id]);
      await client.query('INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, occurred_at, request_id, safe_metadata) VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, NOW(), $6, $7::jsonb);', [invitation.tenant_id, invitation.user_id, 'INVITATION_ACCEPT', 'membership', member.rows[0].id, requestId, JSON.stringify({ channel: 'invitation_link' })]);
      return { membershipId: member.rows[0].id };
    });
    res.json({ success: true, data: { email: invitation.email, workspaceName: invitation.workspace_name, membershipId: accepted.membershipId, passwordAlreadySet: Boolean(invitation.password_hash), loginRequired: true, message: 'Invitation accepted. Sign in to continue.' }, meta: { requestId } });
  } catch (err: any) {
    if (err && err.statusCode) { error(res, err.statusCode, err.errorCode || 'INVITATION_ERROR', err.message, requestId); return; }
    dbUnavailable(res, requestId);
  }
});

export default router;
