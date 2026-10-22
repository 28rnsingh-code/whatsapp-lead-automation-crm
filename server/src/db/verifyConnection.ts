import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { resolveDatabaseConfig } from './config';

const rootEnvPath = path.resolve(__dirname, '../../../.env');
const serverEnvPath = path.resolve(__dirname, '../../.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else {
  dotenv.config();
}

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

  // Never try a connection when configuration validation or test-database safety failed.
  if (dbConfig.isBlocked) {
    return {
      hasEnvFile,
      hasDatabaseUrl: Boolean(dbConfig.connectionString),
      targetDatabase: dbConfig.databaseName || undefined,
      connected: false,
      error: dbConfig.blockReason || 'Database connection blocked by safety checks.',
    };
  }

  const databaseUrl = dbConfig.connectionString;
  if (!databaseUrl) {
    return {
      hasEnvFile,
      hasDatabaseUrl: false,
      connected: false,
      error: 'DATABASE_URL is not set. Configure it in the runtime environment.',
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
      error: 'DATABASE_URL is not a valid URL.',
    };
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return {
      hasEnvFile,
      hasDatabaseUrl: true,
      connected: false,
      error: 'DATABASE_URL must use the postgres:// or postgresql:// protocol.',
    };
  }

  const targetDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('?')[0]);
  const targetHost = parsed.hostname;
  const targetPort = Number(parsed.port || 5432);
  const targetUser = decodeURIComponent(parsed.username);

  if (!targetDatabase || targetDatabase.toLowerCase() === 'postgres') {
    return {
      hasEnvFile,
      hasDatabaseUrl: true,
      targetDatabase,
      targetHost,
      targetPort,
      targetUser,
      connected: false,
      error: `Safety guard: target database is '${targetDatabase || '(empty)'}'. Configure the intended application database, not the default 'postgres' database.`,
    };
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    application_name: 'whatsapp-lead-automation-crm-db-verifier',
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    const res = await client.query(
      'SELECT current_database() AS current_database, current_user AS current_user, version() AS version',
    );
    const row = res.rows[0] as {
      current_database: string;
      current_user: string;
      version: string;
    } | undefined;

    if (!row || row.current_database !== targetDatabase) {
      return {
        hasEnvFile,
        hasDatabaseUrl: true,
        targetDatabase,
        targetHost,
        targetPort,
        targetUser,
        connected: false,
        error: 'Safety guard: PostgreSQL connected to a database different from the configured DATABASE_URL target.',
      };
    }

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
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      hasEnvFile,
      hasDatabaseUrl: true,
      targetDatabase,
      targetHost,
      targetPort,
      targetUser,
      connected: false,
      error: error.message,
      errorCode: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    };
  } finally {
    if (connected) {
      try {
        await client.end();
      } catch {
        // Preserve the original verification result if closing the client also fails.
      }
    }
  }
}

if (require.main === module) {
  verifyDatabaseConnection()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.connected ? 0 : 1);
    })
    .catch((error: unknown) => {
      console.error('[DB Verify] Unexpected failure:', error);
      process.exit(1);
    });
}
