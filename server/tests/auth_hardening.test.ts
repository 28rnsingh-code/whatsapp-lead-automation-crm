import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { signToken, hashPassword, verifyPassword } from '../src/services/authService';
import { resolveDatabaseConfig } from '../src/db';

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
        email: process.env.BOOTSTRAP_ADMIN_EMAIL || 'rohan@bringmybite.in',
        password: process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Password123!',
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
    if (resolveDatabaseConfig().isBlocked) {
      expect(allowedRes.status).toBe(503);
      expect(allowedRes.body.error.code).toBe('DATABASE_SAFETY_BLOCKED');
    } else {
      expect(allowedRes.status).toBe(200);
    }

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
});
