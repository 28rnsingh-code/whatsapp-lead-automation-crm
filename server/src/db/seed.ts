import { pool } from './index';
import { hashPassword } from '../services/authService';

export interface SeedResult {
  tenantId: string;
  userId: string;
  stages: { id: string; name: string }[];
}

/**
 * Idempotently initializes a workspace and its first admin.
 * Secrets are provided by the operator and are never hard-coded in source control.
 * Run migrations before running this command.
 */
export async function seedDefaults(): Promise<SeedResult> {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || adminEmail?.split('@')[0] || '';

  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    throw new Error('Set BOOTSTRAP_ADMIN_EMAIL to a valid email before seeding.');
  }
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error('Set BOOTSTRAP_ADMIN_PASSWORD to a unique password of at least 12 characters before seeding.');
  }

  console.log('[Seed] Creating or verifying the CRM workspace and first admin...');

  const tenantRes = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, status, timezone, currency, locale)
     VALUES ('OneClick Autonix CRM', 'oneclick-autonix-crm', 'active', 'Asia/Kolkata', 'INR', 'en-IN')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text AS id;`
  );
  const tenantId = tenantRes.rows[0].id;

  // A conflict never overwrites an existing password. New accounts get the operator-supplied hash.
  const passwordHash = await hashPassword(adminPassword);
  const userRes = await pool.query<{ id: string }>(
    `INSERT INTO users (email_normalized, display_name, password_hash, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (email_normalized) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           status = 'active',
           password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)
     RETURNING id::text AS id;`,
    [adminEmail, adminName, passwordHash]
  );
  const userId = userRes.rows[0].id;

  let roleRes = await pool.query<{ id: string }>(
    `SELECT id::text AS id FROM roles WHERE tenant_id = $1::uuid AND name = 'Admin' LIMIT 1;`,
    [tenantId]
  );
  if (roleRes.rows.length === 0) {
    roleRes = await pool.query<{ id: string }>(
      `INSERT INTO roles (tenant_id, name, description, is_system)
       VALUES ($1::uuid, 'Admin', 'Full administrative workspace privileges', true)
       RETURNING id::text AS id;`,
      [tenantId]
    );
  }
  const roleId = roleRes.rows[0].id;

  await pool.query(
    `INSERT INTO memberships (tenant_id, user_id, role_id, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'active')
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'active';`,
    [tenantId, userId, roleId]
  );

  const permissions = [
    'leads:read', 'leads:write', 'leads:delete', 'pipeline:manage',
    'reports:view', 'team:manage', 'settings:manage', 'audit:read', 'integrations:manage',
  ];
  for (const permission of permissions) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key)
       VALUES ($1::uuid, $2) ON CONFLICT (role_id, permission_key) DO NOTHING;`,
      [roleId, permission]
    );
  }

  const stageDefs = [
    { name: 'New', sortOrder: 1, color: '#155eef', isWon: false, isLost: false },
    { name: 'Contacted', sortOrder: 2, color: '#2e90fa', isWon: false, isLost: false },
    { name: 'Qualified', sortOrder: 3, color: '#7a5af8', isWon: false, isLost: false },
    { name: 'Proposal', sortOrder: 4, color: '#f79009', isWon: false, isLost: false },
    { name: 'Won', sortOrder: 5, color: '#12b76a', isWon: true, isLost: false },
    { name: 'Lost', sortOrder: 6, color: '#f04438', isWon: false, isLost: true },
  ];

  const stages: { id: string; name: string }[] = [];
  for (const stage of stageDefs) {
    const existing = await pool.query<{ id: string; name: string }>(
      'SELECT id::text AS id, name FROM pipeline_stages WHERE tenant_id = $1::uuid AND name = $2 LIMIT 1;',
      [tenantId, stage.name]
    );
    if (existing.rows.length > 0) {
      stages.push(existing.rows[0]);
      continue;
    }
    const inserted = await pool.query<{ id: string; name: string }>(
      `INSERT INTO pipeline_stages (tenant_id, name, sort_order, color_token, is_won, is_lost, active)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, true)
       RETURNING id::text AS id, name;`,
      [tenantId, stage.name, stage.sortOrder, stage.color, stage.isWon, stage.isLost]
    );
    stages.push(inserted.rows[0]);
  }

  await pool.query(
    `INSERT INTO tenant_subscriptions (tenant_id, plan_id, plan_name, status, billing_provider)
     VALUES ($1::uuid, 'starter', 'Free Starter', 'active', 'mock')
     ON CONFLICT (tenant_id) DO NOTHING;`,
    [tenantId]
  );

  console.log(`[Seed] Workspace ready. Tenant ID: ${tenantId}; stages: ${stages.length}`);
  return { tenantId, userId, stages };
}

if (require.main === module) {
  seedDefaults()
    .then(() => pool.end().then(() => process.exit(0)))
    .catch(async (err) => {
      console.error('[Seed] Error:', err instanceof Error ? err.message : 'Unknown error');
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
