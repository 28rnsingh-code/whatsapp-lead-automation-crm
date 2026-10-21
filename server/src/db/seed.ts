import { pool } from './index';
import { hashPassword } from '../services/authService';

export const DEFAULT_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
export const DEFAULT_USER_ID = 'b0000000-0000-0000-0000-000000000001';

export interface SeedResult {
  tenantId: string;
  userId: string;
  stages: { id: string; name: string }[];
}

/**
 * Idempotent seeder: Seeds minimal required default workspace, admin user, and pipeline stages.
 * Safe to run multiple times without duplicating or corrupting data.
 */
export async function seedDefaults(): Promise<SeedResult> {
  console.log('[Seed] Ensuring default tenant and pipeline stages exist in PostgreSQL...');

  // 1. Seed Default Tenant
  const tenantRes = await pool.query<{ id: string }>(
    `INSERT INTO tenants (id, name, slug, status, timezone, currency, locale)
     VALUES ($1, 'Bring My Bite', 'bring-my-bite', 'active', 'Asia/Kolkata', 'INR', 'en-IN')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id;`,
    [DEFAULT_TENANT_ID]
  );
  const tenantId = tenantRes.rows[0].id;

  // 2. Seed Default User (Rohan Singh)
  const passwordHash = await hashPassword('Password123!');
  const userRes = await pool.query<{ id: string }>(
    `INSERT INTO users (id, email_normalized, display_name, password_hash, status)
     VALUES ($1, 'rohan@bringmybite.in', 'Rohan Singh', $2, 'active')
     ON CONFLICT (email_normalized) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id;`,
    [DEFAULT_USER_ID, passwordHash]
  );
  const userId = userRes.rows[0].id;

  // 3. Seed Default System Roles
  const roleRes = await pool.query<{ id: string }>(
    `INSERT INTO roles (tenant_id, name, description, is_system)
     VALUES ($1, 'Admin', 'Full administrative workspace privileges', true)
     RETURNING id;`,
    [tenantId]
  ).catch(async () => {
    // If already exists
    return pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND name = 'Admin' LIMIT 1;`,
      [tenantId]
    );
  });
  const roleId = roleRes.rows[0].id;

  // 4. Seed Membership
  await pool.query(
    `INSERT INTO memberships (tenant_id, user_id, role_id, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (tenant_id, user_id) DO NOTHING;`,
    [tenantId, userId, roleId]
  );

  // 5. Seed Default 6 Pipeline Stages
  const stageDefs = [
    { name: 'New', sortOrder: 1, color: '#155eef', isWon: false, isLost: false },
    { name: 'Contacted', sortOrder: 2, color: '#2e90fa', isWon: false, isLost: false },
    { name: 'Qualified', sortOrder: 3, color: '#7a5af8', isWon: false, isLost: false },
    { name: 'Proposal', sortOrder: 4, color: '#f79009', isWon: false, isLost: false },
    { name: 'Won', sortOrder: 5, color: '#12b76a', isWon: true, isLost: false },
    { name: 'Lost', sortOrder: 6, color: '#f04438', isWon: false, isLost: true },
  ];

  const stages: { id: string; name: string }[] = [];

  for (const st of stageDefs) {
    const existing = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM pipeline_stages WHERE tenant_id = $1 AND name = $2 LIMIT 1;`,
      [tenantId, st.name]
    );

    if (existing.rows.length > 0) {
      stages.push(existing.rows[0]);
    } else {
      const inserted = await pool.query<{ id: string; name: string }>(
        `INSERT INTO pipeline_stages (tenant_id, name, sort_order, color_token, is_won, is_lost, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id, name;`,
        [tenantId, st.name, st.sortOrder, st.color, st.isWon, st.isLost]
      );
      stages.push(inserted.rows[0]);
    }
  }

  console.log(`[Seed] ✓ Defaults active. Tenant ID: ${tenantId}, Stages seeded: ${stages.length}`);
  return { tenantId, userId, stages };
}

if (require.main === module) {
  seedDefaults()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Seed] Error:', err);
      process.exit(1);
    });
}
