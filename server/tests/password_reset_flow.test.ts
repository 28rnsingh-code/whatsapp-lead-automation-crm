import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { pool, resolveDatabaseConfig } from '../src/db';
import { DEFAULT_TENANT_ID } from '../src/db/seed';
import { hashPassword } from '../src/services/authService';

const databaseConfig = resolveDatabaseConfig();
const canExercisePersistentAuth = databaseConfig.isTestEnvironment && !databaseConfig.isBlocked;

describe.skipIf(!canExercisePersistentAuth)('Database-backed password reset end-to-end flow', () => {
  const email = `qa-password-reset-${randomUUID()}@example.test`;
  const oldPassword = 'OldPassword#2026';
  const newPassword = 'NewPassword#2026';
  let userId = '';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const roles = await pool.query<{ id: string }>(
      'SELECT id::text AS id FROM roles WHERE tenant_id = $1::uuid AND name = $2 LIMIT 1;',
      [DEFAULT_TENANT_ID, 'Sales Executive'],
    );
    const roleId = roles.rows[0]?.id;
    if (!roleId) throw new Error('The isolated CRM test database must be seeded before authentication tests run.');

    const passwordHash = await hashPassword(oldPassword);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO users (email_normalized, display_name, password_hash, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id::text AS id;`,
      [email, 'QA Password Reset User', passwordHash],
    );
    userId = inserted.rows[0].id;

    await pool.query(
      `INSERT INTO memberships (tenant_id, user_id, role_id, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'active');`,
      [DEFAULT_TENANT_ID, userId, roleId],
    );
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();

    if (!userId) return;
    await pool.query('DELETE FROM audit_events WHERE actor_user_id = $1::uuid OR (entity_type = $2 AND entity_id = $1::uuid);', [userId, 'user']).catch(() => undefined);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1::uuid;', [userId]).catch(() => undefined);
    await pool.query('DELETE FROM revoked_auth_tokens WHERE user_id = $1::uuid;', [userId]).catch(() => undefined);
    await pool.query('DELETE FROM users WHERE id = $1::uuid;', [userId]).catch(() => undefined);
  });

  it('delivers a reset link, consumes it once, and invalidates the old session', async () => {
    vi.stubEnv('RESEND_API_URL', 'https://api.resend.com/emails');
    vi.stubEnv('RESEND_API_KEY', 'synthetic-resend-key');
    vi.stubEnv('EMAIL_FROM', 'CRM QA <qa@example.test>');
    vi.stubEnv('APP_PUBLIC_URL', 'https://crm.example.test');
    vi.stubEnv('PASSWORD_RESET_TOKEN_EXPIRES_MINUTES', '15');

    fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ id: 'synthetic-email-id' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const loginBeforeReset = await request(app)
      .post('/api/auth/login')
      .send({ email, password: oldPassword });
    expect(loginBeforeReset.status).toBe(200);
    const previousSessionToken = loginBeforeReset.body.data.token as string;

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email });
    expect(forgot.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();

    const sendCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const emailPayload = JSON.parse(String(sendCall[1].body)) as { html: string; text: string; to: string[] };
    expect(emailPayload.to).toEqual([email]);
    const htmlLink = emailPayload.html.match(/href="([^"]+)"/)?.[1];
    expect(htmlLink).toBeDefined();
    const resetUrl = new URL(htmlLink!);
    expect(resetUrl.origin).toBe('https://crm.example.test');
    const rawToken = resetUrl.searchParams.get('token');
    expect(rawToken).toBeTruthy();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: newPassword });
    expect(reset.status).toBe(200);

    const oldSessionCheck = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${previousSessionToken}`);
    expect(oldSessionCheck.status).toBe(401);
    expect(oldSessionCheck.body.error.code).toBe('SESSION_REVOKED');

    const replay = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'AnotherPass#2026' });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('RESET_TOKEN_INVALID');

    const loginAfterReset = await request(app)
      .post('/api/auth/login')
      .send({ email, password: newPassword });
    expect(loginAfterReset.status).toBe(200);
    expect(loginAfterReset.body.success).toBe(true);
  });
});
