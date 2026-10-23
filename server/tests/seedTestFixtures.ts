import { pool, resolveDatabaseConfig } from '../src/db';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../src/db/seed';

/**
 * Test-only fixtures for legacy identity compatibility and tenant isolation.
 * This script is invoked only by CI against TEST_DATABASE_URL. It refuses any
 * non-test DB configuration and never runs as part of the production seed.
 */
async function seedTestFixtures(): Promise<void> {
  const config = resolveDatabaseConfig();
  if (process.env.NODE_ENV !== 'test' || config.isBlocked || !config.databaseName.toLowerCase().includes('test')) {
    throw new Error('Refusing to seed test fixtures outside a dedicated test database.');
  }

  const automicsTenantId = 'a0000000-0000-0000-0000-000000000002';
  const riyaUserId = 'b0000000-0000-0000-0000-000000000002';
  const otherUserId = 'b0000000-0000-0000-0000-000000000003';
  const suspendedUserId = 'b0000000-0000-0000-0000-000000000004';

  // Create the second workspace and its tenant-scoped roles only in the isolated test DB.
  await pool.query(
    `INSERT INTO tenants (id, name, slug, status, timezone, currency, locale)
     VALUES ($1, 'Automics Labs Test Workspace', 'automics-labs-test', 'active', 'Asia/Kolkata', 'INR', 'en-IN')
     ON CONFLICT (id) DO NOTHING`,
    [automicsTenantId]
  );

  const roles = new Map<string, string>();
  for (const tenantId of [DEFAULT_TENANT_ID, automicsTenantId]) {
    for (const roleName of ['Admin', 'Sales']) {
      const existingRes = await pool.query<{id:string}>(
        'SELECT id FROM roles WHERE tenant_id = $1 AND name = $2 LIMIT 1',
        [tenantId, roleName]
      );
      let roleId = existingRes.rows[0]?.id;
      if (!roleId) {
        const inserted = await pool.query<{id:string}>(
          'INSERT INTO roles (tenant_id, name, description, is_system) VALUES ($1, $2, $3, $4) RETURNING id',
          [tenantId, roleName, 'CI fixture role', true]
        );
        roleId = inserted.rows[0].id;
      }
      roles.set(`${tenantId}:${roleName}`, roleId);
    }
  }

  const userFixtures = [
    {id:riyaUserId,email:'riya@bringmybite.in',name:'Riya Singh',tenantId:DEFAULT_TENANT_ID,role:'Sales',membership:'active'},
    {id:suspendedUserId,email:'suspended@bringmybite.in',name:'Suspended Test Member',tenantId:DEFAULT_TENANT_ID,role:'Sales',membership:'suspended'},
  ];

  // Create the non-member identity without granting it membership in either workspace.
  await pool.query(
    `INSERT INTO users (id, email_normalized, display_name, password_hash, status)
     VALUES ($1, $2, $3, NULL, 'active')
     ON CONFLICT (email_normalized) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [otherUserId, 'other@competitor.in', 'Other Tenant Test User']
  );

  for (const u of userFixtures) {
    const userResult = await pool.query<{id:string}>(
      `INSERT INTO users (id, email_normalized, display_name, password_hash, status)
       VALUES ($1, $2, $3, NULL, 'active')
       ON CONFLICT (email_normalized) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [u.id,u.email,u.name]
    );
    const userId = userResult.rows[0].id;
    const roleId = roles.get(`${u.tenantId}:${u.role}`)!;
    await pool.query(
      `INSERT INTO memberships (tenant_id, user_id, role_id, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = EXCLUDED.status`,
      [u.tenantId,userId,roleId,u.membership]
    );
  }

  // Rohan is expected to be present in both workspaces for cross-workspace not-found
  // testing, while the second fixture user's membership is separately tenant-scoped.
  await pool.query(
    `INSERT INTO memberships (tenant_id, user_id, role_id, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [automicsTenantId, DEFAULT_USER_ID, roles.get(`${automicsTenantId}:Admin`)]
  );

  // Seed minimal rows used by API tests so "initial list" endpoint assertions are deterministic.
  await pool.query(
    `INSERT INTO tasks (tenant_id, title, task_type, owner_user_id, due_at, priority, status, created_by)
     SELECT $1, 'Initial Discovery Call', 'Call', $2, NOW() + INTERVAL '2 hours', 'High', 'Pending', $2
     WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE tenant_id = $1)`,
    [DEFAULT_TENANT_ID, DEFAULT_USER_ID]
  );
  await pool.end();
}

seedTestFixtures().catch(async error => {
  console.error('[Test Fixtures] Failed:', error);
  try { await pool.end(); } catch {}
  process.exitCode = 1;
});
