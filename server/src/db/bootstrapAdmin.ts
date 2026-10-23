import readline from 'readline';
import { pool, closePool } from './index';
import { hashPassword } from '../services/authService';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function askPassword(): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  stdout.write('Admin password (minimum 12 characters; input hidden): ');
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = Boolean((stdin as any).isRaw);
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\\u0003') { cleanup(); reject(new Error('Cancelled.')); return; }
        if (char === '\\r' || char === '\\n') { cleanup(); stdout.write('\\n'); resolve(value); return; }
        if (char === '\\u007f' || char === '\\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || await ask('Admin email [one.clickautonix@gmail.com]: ') || 'one.clickautonix@gmail.com').trim().toLowerCase();
  const displayName = process.env.BOOTSTRAP_ADMIN_NAME || await ask('Admin display name [One.Click Autonix Admin]: ') || 'One.Click Autonix Admin';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid admin email is required.');

  const password = await askPassword();
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Password must include uppercase, lowercase, a number, and a symbol.');
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenantResult = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, status, timezone, currency, locale)
       VALUES ('Bring My Bite', 'bring-my-bite', 'active', 'Asia/Kolkata', 'INR', 'en-IN')
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`
    );
    const tenantId = tenantResult.rows[0].id;

    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (email_normalized, display_name, password_hash, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (email_normalized) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             password_hash = EXCLUDED.password_hash,
             status = 'active',
             updated_at = NOW()
       RETURNING id`,
      [email, displayName, passwordHash]
    );
    const userId = userResult.rows[0].id;

    let roleResult = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND name = 'Admin' ORDER BY created_at ASC LIMIT 1`,
      [tenantId]
    );
    let roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      const insertedRole = await client.query<{ id: string }>(
        `INSERT INTO roles (tenant_id, name, description, is_system)
         VALUES ($1, 'Admin', 'Full administrative workspace privileges', TRUE) RETURNING id`,
        [tenantId]
      );
      roleId = insertedRole.rows[0].id;
    }

    await client.query(
      `INSERT INTO role_permissions (role_id, permission_key) VALUES
       ($1, 'leads:read'), ($1, 'leads:write'), ($1, 'leads:delete'),
       ($1, 'pipeline:manage'), ($1, 'reports:view'), ($1, 'team:manage')
       ON CONFLICT (role_id, permission_key) DO NOTHING`,
      [roleId]
    );
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role_id, status, accepted_at)
       VALUES ($1, $2, $3, 'active', NOW())
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET role_id = EXCLUDED.role_id, status = 'active', accepted_at = NOW()`,
      [tenantId, userId, roleId]
    );

    const stages = [
      ['New', 1, '#155eef', false, false],
      ['Contacted', 2, '#2e90fa', false, false],
      ['Qualified', 3, '#7a5af8', false, false],
      ['Proposal', 4, '#f79009', false, false],
      ['Won', 5, '#12b76a', true, false],
      ['Lost', 6, '#f04438', false, true],
    ] as const;
    for (const [name, sortOrder, color, isWon, isLost] of stages) {
      await client.query(
        `INSERT INTO pipeline_stages (tenant_id, name, sort_order, color_token, is_won, is_lost, active)
         SELECT $1, $2, $3, $4, $5, $6, TRUE
         WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE tenant_id = $1 AND name = $2)`,
        [tenantId, name, sortOrder, color, isWon, isLost]
      );
    }
    await client.query('COMMIT');
    console.log('Admin bootstrap complete.');
    console.log('Admin email:', email);
    console.log('Tenant ID:', tenantId);
    console.log('Workspace name was preserved as Bring My Bite.');
    console.log('Keep this terminal private. Do not paste the password or DATABASE_URL into chat.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(async error => {
  console.error('[Admin bootstrap failed]', error instanceof Error ? error.message : 'Unknown error');
  try { await closePool(); } catch {}
  process.exitCode = 1;
});
