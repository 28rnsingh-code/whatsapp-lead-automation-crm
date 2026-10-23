import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { signToken } from '../src/services/authService';

describe('OneClick Automics CRM API Contracts & Envelope', () => {
  const validToken = signToken({
    userId: 'user_rohan_singh',
    email: 'rohan@bringmybite.in',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  it('GET /api/health should return 200 with standard success envelope and requestId', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('status', 'healthy');
    expect(res.body.data).toHaveProperty('service', 'oneclick-automics-crm-api');
    expect(res.body.meta).toHaveProperty('requestId');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/health remains a liveness endpoint independent of database readiness', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'healthy');
  });

  it('GET /api/ready verifies the database before claiming readiness', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.data).toHaveProperty('status', 'ready');
    expect(res.body.data.checks).toHaveProperty('database', 'healthy');
    expect(res.body.meta).toHaveProperty('requestId');
  });

  it('GET /api/workspaces returns persisted active memberships for the signed-in account', async () => {
    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const workspace of res.body.data) {
      expect(workspace).toHaveProperty('id');
      expect(workspace).toHaveProperty('name');
      expect(workspace).toHaveProperty('role');
      expect(workspace.id).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('GET /api/workspaces without auth header should return 401 Unauthenticated', async () => {
    const res = await request(app).get('/api/workspaces');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toHaveProperty('code', 'UNAUTHENTICATED');
  });

  it('GET /api/leads with signed JWT should return 200 with tenant-scoped leads', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${validToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('totalCount');
    expect(res.body.meta).toHaveProperty('page', 1);

    // Verify all returned leads belong to the active tenant
    for (const lead of res.body.data) {
      expect(lead.tenantId).toBe('tenant_bring_my_bite');
    }
  });

  it('GET /api/leads with forbidden tenant ID should return 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${validToken}`)
      .set('x-tenant-id', 'forbidden_tenant');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('POST /api/leads should return 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${validToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveProperty('name');
    expect(res.body.error.details).toHaveProperty('phoneRaw');
  });
});
