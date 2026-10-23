import { Pool, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import {
  resolveDatabaseConfig,
  DatabaseSafetyError,
  SHARED_DEV_DB_NAME,
  DEFAULT_TEST_DB_NAME,
  parseDatabaseName,
  isSharedDevelopmentDatabase,
  isDedicatedTestDatabase,
  DatabaseConfig,
} from './config';

export {
  resolveDatabaseConfig,
  DatabaseSafetyError,
  SHARED_DEV_DB_NAME,
  DEFAULT_TEST_DB_NAME,
  parseDatabaseName,
  isSharedDevelopmentDatabase,
  isDedicatedTestDatabase,
  DatabaseConfig,
};

const rootEnvPath = path.resolve(__dirname, '../../../.env');
const serverEnvPath = path.resolve(__dirname, '../../.env');
const rootTestEnvPath = path.resolve(__dirname, '../../../.env.test');
const serverTestEnvPath = path.resolve(__dirname, '../../.env.test');

// In test environment, prioritize .env.test if present
if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
  if (fs.existsSync(rootTestEnvPath)) {
    dotenv.config({ path: rootTestEnvPath, override: true });
  } else if (fs.existsSync(serverTestEnvPath)) {
    dotenv.config({ path: serverTestEnvPath, override: true });
  }
}

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else {
  dotenv.config();
}

const initialConfig = resolveDatabaseConfig();
const isServerlessRuntime = process.env.VERCEL === '1';

function readPoolSize(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

// Bound per-instance PostgreSQL usage in serverless environments. A minimum
// of two idle connections per function instance can exhaust small DB plans.
const requestedPoolMax = readPoolSize(process.env.DATABASE_POOL_MAX, isServerlessRuntime ? 3 : 10, 1, 50);
const safePoolMax = isServerlessRuntime ? Math.min(requestedPoolMax, 5) : requestedPoolMax;
const poolMin = isServerlessRuntime ? 0 : Math.min(readPoolSize(process.env.DATABASE_POOL_MIN, 0, 0, 20), safePoolMax);

// Unsafe configuration never reaches the pool: guarded query/connect methods
// fail closed before the placeholder pool can establish a connection.
export const pool = new Pool(
  initialConfig.isBlocked
    ? {
        connectionString: 'postgresql://127.0.0.1:5432/blocked_dev_db_safeguard',
        max: 0,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 500,
      }
    : {
        connectionString: initialConfig.connectionString,
        min: poolMin,
        max: safePoolMax,
        idleTimeoutMillis: isServerlessRuntime ? 10000 : 30000,
        connectionTimeoutMillis: 5000,
        allowExitOnIdle: isServerlessRuntime,
      }
);

// Intercept pool.query to enforce safety guard dynamically at query time
const rawPoolQuery = pool.query.bind(pool);
pool.query = function (...args: any[]): any {
  const activeConfig = resolveDatabaseConfig();
  if (activeConfig.isBlocked) {
    return Promise.reject(
      new DatabaseSafetyError(
        activeConfig.blockReason || 'Database query blocked: cannot access development database in test mode.'
      )
    );
  }
  return (rawPoolQuery as any)(...args);
} as any;

// Intercept pool.connect to enforce safety guard on direct client checkouts
const rawPoolConnect = pool.connect.bind(pool);
pool.connect = function (...args: any[]): any {
  const activeConfig = resolveDatabaseConfig();
  if (activeConfig.isBlocked) {
    return Promise.reject(
      new DatabaseSafetyError(
        activeConfig.blockReason || 'Database connection blocked: cannot access development database in test mode.'
      )
    );
  }
  return (rawPoolConnect as any)(...args);
} as any;

pool.on('error', (err) => {
  // Suppress error logging if it is the intentional blocked safeguard
  if (err?.message?.includes('blocked_dev_db_safeguard')) {
    return;
  }
  console.error('[DB] Unexpected error on idle client', err);
});

/**
 * Standard parameterized query runner with safe execution and safeguard enforcement.
 * Enforces parameterization to eliminate SQL injection vulnerabilities.
 * Prevents automated tests from writing to or reading from shared development database.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const activeConfig = resolveDatabaseConfig();
  if (activeConfig.isBlocked) {
    throw new DatabaseSafetyError(
      activeConfig.blockReason || 'Database operations blocked: cannot access development database in test mode.'
    );
  }

  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('[DB Query]', { text: text.substring(0, 100), duration: `${duration}ms`, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('[DB Query Error]', { text, error });
    throw error;
  }
}

/**
 * Executes a callback within a managed transaction.
 */
export async function withTransaction<T>(
  callback: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const activeConfig = resolveDatabaseConfig();
  if (activeConfig.isBlocked) {
    throw new DatabaseSafetyError(
      activeConfig.blockReason || 'Database transaction blocked: cannot access development database in test mode.'
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

