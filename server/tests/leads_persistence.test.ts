import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { pool, resolveDatabaseConfig, DatabaseSafetyError, SHARED_DEV_DB_NAME } from '../src/db';
import { signToken } from '../src/services/authService';
import { DEFAULT_TENANT_ID } from '../src/db/seed';

describe('Leads PostgreSQL Persistence & Tenant Isolation Tests', () => {
  const dbConfig = resolveDatabaseConfig();

  const rohanToken = signToken({
    userId: 'user_rohan_singh',
    email: 'rohan@bringmybite.in',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  const otherTenantToken = signToken({
    userId: 'user_no_membership',
    email: 'no-membership@bringmybite.test',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  // Track created records for guaranteed cleanup by primary key
  const createdLeadIds = new Set<string>();

  // If test configuration points to the shared development database, fail safely
  if (dbConfig.isBlocked) {
    it('should fail safely and block persistence execution when configured against shared development database', async () => {
      expect(dbConfig.isBlocked).toBe(true);
      expect(dbConfig.databaseName).toBe(SHARED_DEV_DB_NAME);
      expect(dbConfig.blockReason).toContain('Tests must never write to the shared development database');

      // 1. Direct pool queries must be rejected by safety guard
      await expect(pool.query('SELECT 1')).rejects.toThrow(DatabaseSafetyError);

      // 2. HTTP POST mutations must be blocked safely (503 DATABASE_SAFETY_BLOCKED)
      const res = await request(app)
        .post('/api/leads')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          name: 'Pollution Attempt Lead',
          phoneRaw: '+919999888877',
          email: 'blocked@bringmybite.in',
        });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DATABASE_SAFETY_BLOCKED');
      expect(res.body.error.message).toContain('Safety guard violation');
    });

    return;
  }

  // =========================================================================
  // When a dedicated test database is configured (TEST_DATABASE_URL):
  // Run isolated persistence tests and reliably clean up all records by ID
  // =========================================================================

  const runId = Math.random().toString(36).substring(2, 8);
  const testPhone = `+919811${Math.floor(100000 + Math.random() * 900000)}`;
  const testLeadName = `Demo Lead QA ${runId}`;
  const testEmail = `demo.qa.${runId}@bringmybite.in`;
  let createdLeadId: string = '';

  // Reliable cleanup hook: runs even if individual test assertions fail
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
      console.warn('[Cleanup] Error cleaning up test leads:', err);
    }
  });

  it('1. POST /api/leads should insert lead into PostgreSQL and return 201 with UUID', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        name: testLeadName,
        phoneRaw: testPhone,
        email: testEmail,
        companyName: 'Autonics Testing Ltd',
        source: 'Website',
        dealValue: '250000',
        nextAction: 'Call',
        notes: 'Created during P0 persistence verification suite.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.name).toBe(testLeadName);
    expect(res.body.data.phoneRaw).toBe(testPhone);
    expect(res.body.data.tenantId).toBe('tenant_bring_my_bite');
    expect(res.body.data.dealValueMinorUnits).toBe(25000000);
    expect(res.body.data.stageName).toBeDefined();

    createdLeadId = res.body.data.id;
    createdLeadIds.add(createdLeadId);
    expect(createdLeadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('2. Directly query PostgreSQL to verify physical row persistence in leads table', async () => {
    expect(createdLeadId).toBeTruthy();

    const dbRes = await pool.query(
      `SELECT id, tenant_id, name, phone_raw, phone_normalized, email, company_name, deal_value_minor_units
       FROM leads
       WHERE id = $1;`,
      [createdLeadId]
    );

    expect(dbRes.rows.length).toBe(1);
    const row = dbRes.rows[0];
    expect(row.id).toBe(createdLeadId);
    expect(row.tenant_id).toBe(DEFAULT_TENANT_ID);
    expect(row.name).toBe(testLeadName);
    expect(row.phone_raw).toBe(testPhone);
    expect(row.email).toBe(testEmail);
    expect(row.company_name).toBe('Autonics Testing Ltd');
    expect(Number(row.deal_value_minor_units)).toBe(25000000);
  });

  it('3. GET /api/leads/:id should retrieve the persisted lead by ID from PostgreSQL', async () => {
    const res = await request(app)
      .get(`/api/leads/${createdLeadId}`)
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdLeadId);
    expect(res.body.data.name).toBe(testLeadName);
    expect(res.body.data.phoneRaw).toBe(testPhone);
    expect(res.body.data.tenantId).toBe('tenant_bring_my_bite');
    expect(res.body.data.activities).toBeDefined();
    expect(Array.isArray(res.body.data.activities)).toBe(true);
  });

  it('4. GET /api/leads should list the persisted lead among results', async () => {
    const res = await request(app)
      .get(`/api/leads?q=${encodeURIComponent(testLeadName)}`)
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find((l: any) => l.id === createdLeadId);
    expect(found).toBeDefined();
    expect(found.name).toBe(testLeadName);
  });

  it('5. Duplicate Phone check: POST /api/leads with same phone should return 409 Conflict', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        name: 'Demo Lead Duplicate Attempt',
        phoneRaw: testPhone,
        email: 'another@email.com',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DUPLICATE_LEAD');
    expect(res.body.error.details.existingLeadId).toBe(createdLeadId);
  });

  it('6. Validation check: POST /api/leads with missing name/phone should return 400', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_bring_my_bite')
      .send({
        email: 'incomplete@domain.com',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveProperty('name');
    expect(res.body.error.details).toHaveProperty('phoneRaw');
  });

  it('7. Tenant Isolation: Querying a lead across workspace boundary should return 404, unauthorized user 403', async () => {
    // Rohan has membership in both tenant_bring_my_bite and tenant_automics_labs
    // Switching to tenant_automics_labs must not expose leads belonging to Bring My Bite (returns 404)
    const crossWorkspaceRes = await request(app)
      .get(`/api/leads/${createdLeadId}`)
      .set('Authorization', `Bearer ${rohanToken}`)
      .set('x-tenant-id', 'tenant_automics_labs');

    expect(crossWorkspaceRes.status).toBe(404);
    expect(crossWorkspaceRes.body.success).toBe(false);
    expect(crossWorkspaceRes.body.error.code).toBe('NOT_FOUND');

    // A user with no membership in the workspace is rejected with 403 Forbidden
    const unauthRes = await request(app)
      .get(`/api/leads/${createdLeadId}`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .set('x-tenant-id', 'tenant_automics_labs');

    expect(unauthRes.status).toBe(403);
    expect(unauthRes.body.success).toBe(false);
    expect(unauthRes.body.error.code).toBe('TENANT_ACCESS_DENIED');
  });
});
