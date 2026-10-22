import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Database Migration & Multi-Tenant DDL Verification', () => {
  const migrationPath = path.join(__dirname, '../src/db/migrations/001_initial_schema.sql');

  it('migration file 001_initial_schema.sql should exist and not be empty', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const content = fs.readFileSync(migrationPath, 'utf-8');
    expect(content.length).toBeGreaterThan(500);
  });

  it('should define all 11 core tables specified in 02_DATA_MODEL.md', () => {
    const content = fs.readFileSync(migrationPath, 'utf-8');
    const requiredTables = [
      '_migrations',
      'tenants',
      'users',
      'roles',
      'role_permissions',
      'memberships',
      'pipeline_stages',
      'leads',
      'tasks',
      'activities',
      'audit_events',
      'integrations',
    ];

    for (const table of requiredTables) {
      expect(content).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('every tenant-owned entity table must strictly contain tenant_id foreign key', () => {
    const content = fs.readFileSync(migrationPath, 'utf-8');
    const tenantScopedTables = [
      'roles',
      'memberships',
      'pipeline_stages',
      'leads',
      'tasks',
      'activities',
      'audit_events',
      'integrations',
    ];

    for (const table of tenantScopedTables) {
      // Find table definition block
      const regex = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([\\s\\S]*?\\);`, 'm');
      const match = content.match(regex);
      expect(match, `Table ${table} definition missing`).not.toBeNull();
      expect(match![0]).toContain('tenant_id');
      expect(match![0]).toContain('REFERENCES tenants(id)');
    }
  });

  it('must define composite indexes for tenant-scoped query performance', () => {
    const content = fs.readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('CREATE INDEX IF NOT EXISTS idx_leads_tenant_stage ON leads(tenant_id, stage_id);');
    expect(content).toContain('CREATE INDEX IF NOT EXISTS idx_tasks_tenant_owner_status ON tasks(tenant_id, owner_user_id, status);');
    expect(content).toContain('CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_time ON audit_events(tenant_id, occurred_at DESC);');
  });

  it('adds a defense-in-depth lockdown for Supabase public API roles', () => {
    const accessPath = path.join(__dirname, '../src/db/migrations/003_public_api_lockdown.sql');
    expect(fs.existsSync(accessPath)).toBe(true);
    const content = fs.readFileSync(accessPath, 'utf-8');
    expect(content).toContain('ENABLE ROW LEVEL SECURITY');
    expect(content).toContain('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I');
    expect(content).toContain("'anon'");
    expect(content).toContain("'authenticated'");
    for (const table of ['leads', 'users', 'memberships', 'tenant_settings', 'whatsapp_messages']) {
      expect(content).toContain(`'${table}'`);
    }
  });

  it('protects invitation token storage in migration 005', () => {
    const migrationPath = path.join(__dirname, '../src/db/migrations/005_workspace_invitations_rls.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);
    const content = fs.readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('workspace_invitations');
    expect(content).toContain('ENABLE ROW LEVEL SECURITY');
    expect(content).toContain('authenticated');
  });
});
