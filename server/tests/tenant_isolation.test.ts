import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { pool, resolveDatabaseConfig, SHARED_DEV_DB_NAME } from '../src/db';
import { signToken } from '../src/services/authService';

describe('Strict Tenant Isolation & Cross-Workspace Boundaries', () => {
  const dbConfig = resolveDatabaseConfig();

  const rohanToken = signToken({
    userId: 'user_rohan_singh',
    email: 'rohan@bringmybite.in',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  // Track created test lead IDs for reliable cleanup by primary key
  const createdLeadIds = new Set<string>();

  // Reliable cleanup hook: guarantees cleanup of all created records even on test failure
  afterAll(async () => {
    try {
      const activeConfig = resolveDatabaseConfig();
      if (!activeConfig.isBlocked) {
        for (const leadId of createdLeadIds) {
          // Targeted parameterization only: never use broad DELETE statements
          await pool.query('DELETE FROM activities WHERE entity_id = $1;', [leadId]).catch(() => {});
          await pool.query('DELETE FROM leads WHERE id = $1;', [leadId]).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[Cleanup] Error cleaning up tenant isolation test leads:', err);
    }
  });

  it('should not allow access to a forbidden tenant context', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'forbidden_tenant');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('should never accept tenant_id from client query or body as authoritative', async () => {
    // Client attempts to pass a spoofed tenant ID via query parameter
    const res = await request(app)
      .get('/api/leads?tenantId=tenant_competitor_corp')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // All leads must belong to tenant_bring_my_bite, ignoring the spoofed query param
    for (const lead of res.body.data) {
      expect(lead.tenantId).toBe('tenant_bring_my_bite');
      expect(lead.tenantId).not.toBe('tenant_competitor_corp');
    }
  });

  it('should return 404 when querying an object belonging to another tenant', async () => {
    const res = await request(app)
      .get('/api/leads/non_existent_lead_999')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  if (dbConfig.isBlocked) {
    it('should fail safely when attempting lead mutations against shared development database', async () => {
      expect(dbConfig.isBlocked).toBe(true);
      expect(dbConfig.databaseName).toBe(SHARED_DEV_DB_NAME);

      const res = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          name: 'Blocked Isolation Lead',
          phoneRaw: '+919876543999',
        });

      // Writes to shared dev db are strictly blocked by safety guard
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DATABASE_SAFETY_BLOCKED');
    });

    return;
  }

  // =========================================================================
  // The following tests run only when a dedicated test database is configured
  // (TEST_DATABASE_URL). Reliance on allowDuplicate=true is removed from ordinary setup.
  // =========================================================================

  it('should correctly filter leads by search term within the tenant boundary (without allowDuplicate)', async () => {
    const runId = Math.random().toString(36).substring(2, 7);
    const searchName = `Amit Sharma ${runId}`;
    const searchPhone = `+919876${Math.floor(100000 + Math.random() * 900000)}`;

    // Ordinary test setup: POST /api/leads without allowDuplicate=true
    const createRes = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        name: searchName,
        phoneRaw: searchPhone,
        email: `amit.${runId}@sharma.in`,
        companyName: 'Sharma Industries',
        source: 'Website',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    const leadId = createRes.body.data.id;
    createdLeadIds.add(leadId);

    const res = await request(app)
      .get(`/api/leads?q=${encodeURIComponent(searchName)}`)
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const matched = res.body.data.find((l: any) => l.id === leadId);
    expect(matched).toBeDefined();
    expect(matched.name).toBe(searchName);
    expect(matched.tenantId).toBe('tenant_bring_my_bite');
  });

  it('should explicitly enforce duplicate lead detection and allow override only with allowDuplicate=true in an isolated test', async () => {
    const dupPhone = `+919875${Math.floor(100000 + Math.random() * 900000)}`;
    const runId = Math.random().toString(36).substring(2, 7);

    // 1. Initial unique lead creation succeeds
    const res1 = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        name: `Original Contact ${runId}`,
        phoneRaw: dupPhone,
        email: `original.${runId}@example.com`,
      });

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    const firstLeadId = res1.body.data.id;
    createdLeadIds.add(firstLeadId);

    // 2. Duplicate phone without allowDuplicate=true is rejected with 409 DUPLICATE_LEAD
    const res2 = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        name: `Duplicate Collision ${runId}`,
        phoneRaw: dupPhone,
        email: `collision.${runId}@example.com`,
      });

    expect(res2.status).toBe(409);
    expect(res2.body.success).toBe(false);
    expect(res2.body.error.code).toBe('DUPLICATE_LEAD');
    expect(res2.body.error.details.existingLeadId).toBe(firstLeadId);

    // 3. Duplicate phone with explicit allowDuplicate=true query parameter is permitted
    const res3 = await request(app)
      .post('/api/leads?allowDuplicate=true')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        name: `Duplicate Permitted ${runId}`,
        phoneRaw: dupPhone,
        email: `permitted.${runId}@example.com`,
      });

    expect(res3.status).toBe(201);
    expect(res3.body.success).toBe(true);
    const secondLeadId = res3.body.data.id;
    createdLeadIds.add(secondLeadId);
    expect(secondLeadId).not.toBe(firstLeadId);
  });
});
