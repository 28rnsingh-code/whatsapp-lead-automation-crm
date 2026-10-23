import { describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/app';

const DEMO_TENANT = 'a0000000-0000-0000-0000-000000000003';
const DEMO_PASSWORD = process.env.PUBLIC_DEMO_PASSWORD || 'demo123';

async function loginDemo(demoVisitorId = crypto.randomUUID()) {
  return request(app).post('/api/auth/login').send({ email: 'demo', password: DEMO_PASSWORD, demoVisitorId });
}

describe('Public demo isolation and usage limits', () => {


  it('allows demo / demo123 with a restricted workspace and a two-hour session', async () => {
    const res = await loginDemo();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.demo).toEqual({ maxActions: 5, simulatedOutbound: true });
    expect(res.body.data.session.tenant.slug).toBe('public-demo');
    expect(res.body.data.session.role).toBe('Read-only');
    const claims = JSON.parse(Buffer.from(res.body.data.token.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.demo).toBe(true);
    expect(claims.demoSessionId).toBeTruthy();
    expect(claims.demoVisitorId).toBeTruthy();
    expect(claims.exp - claims.iat).toBe(7200);
  });

  it('rejects invalid public demo passwords', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'demo', password: 'not-the-demo-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('blocks demo access to paid workspaces and limits each browser to five write attempts across re-logins', async () => {
    const visitorId = crypto.randomUUID();
    const login = await loginDemo(visitorId);
    expect(login.status).toBe(200);
    const token = login.body.data.token;

    const crossTenant = await request(app)
      .get('/api/leads')
      .set('Authorization', 'Bearer ' + token)
      .set('x-tenant-id', 'a0000000-0000-0000-0000-000000000001');
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error.code).toBe('DEMO_TENANT_ONLY');

    for (let index = 0; index < 5; index += 1) {
      const attempt = await request(app)
        .post('/api/leads')
        .set('Authorization', 'Bearer ' + token)
        .set('x-tenant-id', DEMO_TENANT)
        .send({});
      expect(attempt.status).toBe(400);
      expect(attempt.body.error.code).toBe('VALIDATION_ERROR');
    }

    // A fresh access token for the same browser must not reset the quota.
    const relogin = await loginDemo(visitorId);
    expect(relogin.status).toBe(200);
    const limited = await request(app)
      .post('/api/leads')
      .set('Authorization', 'Bearer ' + relogin.body.data.token)
      .set('x-tenant-id', DEMO_TENANT)
      .send({ name: 'Demo Limit Test', phoneRaw: '+919900000001' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('DEMO_LIMIT_REACHED');
    expect(limited.body.error.limit).toBe(5);
  });

  it('simulates a WhatsApp send in demo and never calls a provider', async () => {
    const login = await loginDemo();
    expect(login.status).toBe(200);
    const res = await request(app)
      .post('/api/whatsapp/messages')
      .set('Authorization', 'Bearer ' + login.body.data.token)
      .set('x-tenant-id', DEMO_TENANT)
      .send({ recipientPhone: '+919876543210', body: 'This message must not leave the demo environment.' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('simulated');
    expect(res.body.data.providerMessageId).toMatch(/^demo-sim-/);
    expect(res.body.meta.demoMode).toBe(true);
    expect(res.body.meta.providerSent).toBe(false);
    expect(res.body.meta.notice).toMatch(/No WhatsApp message was sent/);
  });
});
