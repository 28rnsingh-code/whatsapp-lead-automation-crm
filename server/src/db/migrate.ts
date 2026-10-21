import fs from 'fs';
import path from 'path';
import { pool, withTransaction } from './index';
import { verifyDatabaseConnection } from './verifyConnection';

export async function runMigrations(): Promise<void> {
  console.log('[Migration] Verifying target database connection before executing...');
  
  // 1. Connection & safety pre-flight check
  const verification = await verifyDatabaseConnection();
  if (!verification.connected) {
    console.error('\n======================================================');
    console.error('⛔ DATABASE MIGRATION ABORTED (Safety Pre-flight Failed)');
    console.error('======================================================');
    console.error(`Reason: ${verification.error}`);
    if (verification.targetDatabase) {
      console.error(`Target Database: ${verification.targetDatabase}`);
    }
    console.error('Migrations will not run against unverified databases.');
    console.error('======================================================\n');
    throw new Error(`Database connection pre-flight check failed: ${verification.error}`);
  }

  console.log(`[Migration] ✓ Verified target database: "${verification.targetDatabase}" on ${verification.targetHost}:${verification.targetPort} (user: ${verification.targetUser})`);
  console.log(`[Migration] Database Version: ${verification.dbVersion}`);

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn('[Migration] Migrations directory does not exist:', migrationsDir);
    return;
  }

  // 2. Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 3. Fetch applied migrations
  const { rows: applied } = await pool.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id ASC;'
  );
  const appliedSet = new Set(applied.map(r => r.name));

  // 4. Scan and execute unapplied SQL migrations
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[Migration] ✓ Already applied: ${file}`);
      continue;
    }

    console.log(`[Migration] ⚙ Applying migration: ${file}...`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (name) VALUES ($1);',
        [file]
      );
    });

    console.log(`[Migration] ✓ Successfully applied: ${file}`);
  }

  console.log('[Migration] All migrations completed successfully.');
}

// Allow direct CLI execution: `npm run migrate --workspace=server`
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration] Failed:', err.message);
      process.exit(1);
    });
}
