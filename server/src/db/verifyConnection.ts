import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Look for .env in root or server directory
const rootEnvPath = path.resolve(__dirname, '../../../.env');
const serverEnvPath = path.resolve(__dirname, '../../.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else {
  dotenv.config();
}

import { resolveDatabaseConfig, isAllowedDatabaseTarget } from './config';

export interface VerificationResult {
  hasEnvFile: boolean;
  hasDatabaseUrl: boolean;
  targetDatabase?: string;
  targetHost?: string;
  targetPort?: number;
  targetUser?: string;
  connected: boolean;
  error?: string;
  errorCode?: string;
  dbVersion?: string;
}

export async function verifyDatabaseConnection(): Promise<VerificationResult> {
  const hasEnvFile = fs.existsSync(rootEnvPath) || fs.existsSync(serverEnvPath);
  const dbConfig = resolveDatabaseConfig();

  // Test environment safety guard pre-flight
  if (dbConfig.isBlocked) {
    return {
      hasEnvFile,
      hasDatabaseUrl: Boolean(dbConfig.connectionString),
      targetDatabase: dbConfig.databaseName,
      connected: false,
      error: dbConfig.blockReason,
    };
  }

  const databaseUrl = dbConfig.connectionString || process.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.includes('postgres_password')) {
    return {
      hasEnvFile,
      hasDatabaseUrl: Boolean(databaseUrl),
      connected: false,
      error: !databaseUrl 
        ? 'DATABASE_URL is not set in environment or .env file.' 
        : 'DATABASE_URL contains placeholder credentials ("postgres_password").',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return {
      hasEnvFile,
      hasDatabaseUrl: true,
      connected: false,
      error: 'DATABASE_URL is not a valid PostgreSQL connection string URL.',
    };
  }

  const targetDatabase = parsed.pathname.replace(/^\//, '');
  const targetHost = parsed.hostname;
  const targetPort = parseInt(parsed.port || '5432', 10);
  const targetUser = parsed.username;

  // Local/default postgres databases are blocked. Supabase's postgres database is allowed
  // only when the hostname is an explicit Supabase project or pooler endpoint.
  if (!isAllowedDatabaseTarget(targetDatabase, targetHost)) {
    return {
      hasEnvFile,
      hasDatabaseUrl: true,
      targetDatabase,
      targetHost,
      targetPort,
      targetUser,
      connected: false,
      error: `Safety guard: target database '${targetDatabase}' is not allowed for host '${targetHost}'. Use a dedicated local database, or a Supabase project connection URL.`,
    };
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3500,
  });

  try {
    await client.connect();
    const res = await client.query('SELECT current_database(), current_user, version()');
    await client.end();

    const row = res.rows[0];
    return {
      hasEnvFile,
      hasDatabaseUrl: true,
      targetDatabase: row.current_database,
      targetHost,
      targetPort,
      targetUser: row.current_user,
      connected: true,
      dbVersion: row.version.split(' on ')[0],
    };
  } catch (err: any) {
    try { await client.end(); } catch {}
    return {
      hasEnvFile,
      hasDatabaseUrl: true,
      targetDatabase,
      targetHost,
      targetPort,
      targetUser,
      connected: false,
      error: err.message,
      errorCode: err.code,
    };
  }
}

if (require.main === module) {
  verifyDatabaseConnection().then((res) => {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.connected ? 0 : 1);
  });
}
