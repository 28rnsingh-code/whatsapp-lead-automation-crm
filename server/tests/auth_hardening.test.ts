import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { pool } from '../src/db';
import { app } from '../src/app';
import { signToken, hashPassword, verifyPassword } from '../src/services/authService';

describe('Authentication Hardening, Cryptographic JWTs & Membership Authorization', () => {
  it('hashPassword and verifyPassword should securely hash with salt and verify correctly', async () => {
    const rawPass = 'SecureAdmin#2026';
    const hash = await hashPassword(rawPass);

    expect(hash).not.toBe(rawPass);
    expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);

    const isMatch = await verifyPassword(rawPass, hash);
    expect(isMatch).toBe(true);

    const isWrongMatch = await verifyPassword('WrongPassword', hash);
    expect(isWrongMatch).toBe(false);
  });

  it('POST /api/auth/login with valid credentials should return 200 and a cryptographically signed JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'rohan@bringmybite.in',
        password: 'Password123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.session.user.email).toBe('rohan@bringmybite.in');

    const token = res.body.data.token;
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // Standard JWT header.payload.signature
  });

  it('POST /api/auth/login with invalid password should return 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'rohan@bringmybite.in',
        password: 'IncorrectPassword999',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('POST /api/auth/login with unregistered email should return 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nonexistent_hacker@evil.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /api/auth/session with tampered JWT should return 401 INVALID_TOKEN', async () => {
    const validToken = signToken({
      userId: 'user_rohan_singh',
      email: 'rohan@bringmybite.in',
    });

    // Tamper with signature
    const parts = validToken.split('.');
    parts[2] = 'tampered_signature_' + parts[2].substring(18);
    const tamperedToken = parts.join('.');

    const res = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${tamperedToken}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('GET /api/auth/session with expired JWT should return 401 TOKEN_EXPIRED', async () => {
    // Generate an already-expired token (-1s)
    const expiredToken = signToken(
      { userId: 'user_rohan_singh', email: 'rohan@bringmybite.in' },
      '-1s'
    );

    const res = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('should enforce workspace membership: reject user accessing workspace where they have no membership', async () => {
    // Riya Singh is a member of tenant_bring_my_bite, NOT member of tenant_automics_labs
    const riyaToken = signToken({
      userId: 'user_riya_singh',
      email: 'riya@bringmybite.in',
    });

    // Valid workspace access
    const allowedRes = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${riyaToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');
    expect(allowedRes.status).toBe(200);

    // Cross-tenant access where user is not a member
    const forbiddenRes = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${riyaToken}`)
      .set('x-tenant-id', 'tenant_automics_labs');
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.error.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('should reject access if membership status is suspended', async () => {
    const suspendedToken = signToken({
      userId: 'user_suspended_member',
      email: 'suspended@bringmybite.in',
    });

    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${suspendedToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MEMBERSHIP_SUSPENDED');
  });
  it('serves persisted team records to workspace Admins and denies non-admin team management', async () => {
    const adminToken = signToken({
      userId: 'user_rohan_singh',
      email: 'rohan@bringmybite.in',
      defaultTenantId: 'a0000000-0000-0000-0000-000000000001',
    });
    const listing = await request(app)
      .get('/api/team/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');
    expect(listing.status).toBe(200);
    expect(Array.isArray(listing.body.data.members)).toBe(true);
    expect([2, 5, 10]).toContain(listing.body.data.maxMembers);
    expect(listing.body.data.remainingSeats).toBeGreaterThanOrEqual(0);
    expect(listing.body.data.remainingSeats).toBeLessThanOrEqual(listing.body.data.maxMembers);

    const nonAdminToken = signToken({
      userId: 'user_riya_singh',
      email: 'riya@bringmybite.in',
      defaultTenantId: 'a0000000-0000-0000-0000-000000000001',
    });
    const denied = await request(app)
      .get('/api/team/members')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('requires a newly-created member to change their temporary password before using CRM APIs', async () => {
    const tenantId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const suffix = crypto.randomUUID();
    const adminEmail = `ci-admin-${suffix}@example.test`;
    const memberEmail = `ci-member-${suffix}@example.test`;

    await pool.query(
      "INSERT INTO tenants (id, name, slug, status) VALUES ($1, 'CI Team Test', $2, 'active')",
      [tenantId, `ci-team-${suffix}`],
    );
    const admin = await pool.query(
      "INSERT INTO users (id, email_normalized, display_name, password_hash, status) VALUES ($1, $2, 'CI Team Admin', NULL, 'active') RETURNING id",
      [adminId, adminEmail],
    );
    const role = await pool.query(
      "INSERT INTO roles (tenant_id, name, description, is_system) VALUES ($1, 'Admin', 'CI team admin', TRUE) RETURNING id",
      [tenantId],
    );
    await pool.query(
      "INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'active')",
      [tenantId, admin.rows[0].id, role.rows[0].id],
    );
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, plan_name, status, billing_provider, limits, current_period_start, current_period_end)
       VALUES ($1, 'growth', 'Growth Plan', 'active', 'mock',
       '{"maxMembers":5,"maxLeads":10000,"maxImportsPerMonth":100,"maxMessagesPerMonth":5000,"maxAiTokens":500000}'::jsonb,
       NOW(), NOW() + INTERVAL '30 days')`,
      [tenantId],
    );

    const adminToken = signToken({ userId: adminId, email: adminEmail, defaultTenantId: tenantId });
    const created = await request(app).post('/api/team/members')
      .set('Authorization', `Bearer ${adminToken}`).set('x-tenant-id', tenantId)
      .send({ email: memberEmail, displayName: 'CI Member', role: 'Sales Executive' });
    expect(created.status).toBe(201);
    expect(created.body.data.temporaryPassword).toBeTruthy();
    expect(created.body.data.mustChangePassword).toBe(true);

    const login = await request(app).post('/api/auth/login')
      .send({ email: memberEmail, password: created.body.data.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.data.session.mustChangePassword).toBe(true);

    const blocked = await request(app).get('/api/leads')
      .set('Authorization', `Bearer ${login.body.data.token}`).set('x-tenant-id', tenantId);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .send({ currentPassword: created.body.data.temporaryPassword, newPassword: `NewGoodPass!${suffix.slice(0, 8)}A1` });
    expect(changed.status).toBe(200);
    expect(changed.body.data.session.mustChangePassword).toBe(false);

    const permitted = await request(app).get('/api/leads')
      .set('Authorization', `Bearer ${changed.body.data.token}`).set('x-tenant-id', tenantId);
    expect(permitted.status).toBe(200);
  });

});
