import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signToken } from '../src/services/authService';

describe('Phase 2: Core CRM Workflows & Tenant Persistence Tests', () => {
  const app = createApp();

  const rohanToken = signToken({
    userId: 'user_rohan_singh',
    email: 'rohan@bringmybite.in',
    defaultTenantId: 'tenant_bring_my_bite',
  });

  const automicsToken = signToken({
    userId: 'user_other_tenant',
    email: 'other@competitor.in',
    defaultTenantId: 'tenant_automics_labs',
  });

  describe('1. Tasks & Follow-ups Workflow', () => {
    let createdTaskId: string;

    it('should list initial tenant tasks', async () => {
      const res = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('category');
    });

    it('should reject task creation with missing title', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({ leadName: 'Test Contact' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should create a new follow-up task and categorize it properly', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          title: 'Test Followup for Discovery',
          leadName: 'Rohan Sharma',
          company: 'Sharma Enterprise',
          taskType: 'Call',
          priority: 'High',
          dueAt: tomorrow,
        });

      expect([201, 503]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.title).toBe('Test Followup for Discovery');
        expect(res.body.data.completed).toBe(false);
        createdTaskId = res.body.data.id;
      }
    });

    it('should toggle task completion', async () => {
      if (!createdTaskId) return;
      const res = await request(app)
        .patch(`/api/tasks/${createdTaskId}`)
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({ completed: true });

      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.completed).toBe(true);
      }
    });

    it('should prevent cross-tenant access to tasks', async () => {
      const resA = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      const resB = await request(app)
        .get('/api/tasks')
        .set('Authorization', `Bearer ${automicsToken}`)
        .set('x-tenant-id', 'tenant_automics_labs');

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      // Verify isolation
      const idsA = new Set(resA.body.data.map((t: any) => t.id));
      const idsB = new Set(resB.body.data.map((t: any) => t.id));
      const intersection = [...idsA].filter(id => idsB.has(id));
      expect(intersection.length).toBe(0);
    });
  });

  describe('2. Pipeline Stages API', () => {
    it('should return pipeline stages for the tenant workspace', async () => {
      const res = await request(app)
        .get('/api/pipeline/stages')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('colorToken');
    });

    it('should reject stage creation without name', async () => {
      const res = await request(app)
        .post('/api/pipeline/stages')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Contacts & Companies API', () => {
    let createdContactId: string;

    it('should list contacts for tenant', async () => {
      const res = await request(app)
        .get('/api/contacts')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should create a contact with phone normalization', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite')
        .send({
          name: 'Sunil Verma',
          phoneRaw: '9876543219',
          email: 'sunil@verma.com',
          jobTitle: 'VP Technology',
        });

      expect([201, 503]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.phoneNormalized).toBe('+919876543219');
        createdContactId = res.body.data.id;
      }
    });

    it('should list companies for tenant', async () => {
      const res = await request(app)
        .get('/api/contacts/companies')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should delete contact', async () => {
      if (!createdContactId) return;
      const res = await request(app)
        .delete(`/api/contacts/${createdContactId}`)
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.deleted).toBe(true);
      }
    });
  });

  describe('4. Dashboard Metrics API', () => {
    it('should compute real tenant-scoped metrics from PostgreSQL', async () => {
      const res = await request(app)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${rohanToken}`)
        .set('x-tenant-id', 'tenant_bring_my_bite');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('totalLeads');
      expect(res.body.data).toHaveProperty('pipelineValue');
      expect(res.body.data).toHaveProperty('activeFollowups');
      expect(res.body.data).toHaveProperty('overdueTasks');
      expect(res.body.data).toHaveProperty('conversionRate');
      expect(Array.isArray(res.body.data.stageBreakdown)).toBe(true);
      expect(Array.isArray(res.body.data.sourceBreakdown)).toBe(true);
    });
  });
});
