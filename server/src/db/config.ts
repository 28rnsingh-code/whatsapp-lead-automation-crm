import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

export const SHARED_DEV_DB_NAME = 'oneclick_crm';
export const DEFAULT_TEST_DB_NAME = 'oneclick_crm_test';

export class DatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSafetyError';
  }
}

/**
 * Extracts database name from PostgreSQL connection URL.
 * Example: 'postgresql://user:pass@localhost:5432/oneclick_crm?sslmode=disable' -> 'oneclick_crm'
 */
export function parseDatabaseName(connectionString?: string): string {
  if (!connectionString) return '';
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, '').split('?')[0].trim();
    return db;
  } catch {
    return '';
  }
}

/**
 * Checks if target database is the shared development database.
 */
export function isSharedDevelopmentDatabase(dbName: string): boolean {
  if (!dbName) return false;
  return dbName.trim().toLowerCase() === SHARED_DEV_DB_NAME.toLowerCase();
}

/**
 * Checks if database name qualifies as a dedicated test database.
 * Rules:
 * 1. Must not be the shared development database.
 * 2. Must contain an explicit test indicator (e.g. ends with '_test' or starts with 'test_').
 */
export function isDedicatedTestDatabase(dbName: string): boolean {
  if (!dbName) return false;
  const lower = dbName.trim().toLowerCase();
  if (lower === SHARED_DEV_DB_NAME.toLowerCase()) return false;
  return lower.endsWith('_test') || lower.startsWith('test_') || lower.includes('_test_');
}

export interface DatabaseConfig {
  connectionString: string;
  databaseName: string;
  isTestEnvironment: boolean;
  isBlocked: boolean;
  blockReason?: string;
}

/**
 * Resolves active database configuration and enforces safety invariants:
 * - Tests must NEVER connect or write to the shared development database ('oneclick_crm').
 * - Prefers TEST_DATABASE_URL over DATABASE_URL in test mode.
 * - Fails safely if test configuration points to the development database.
 */
export function resolveDatabaseConfig(): DatabaseConfig {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  if (isTest) {
    // 1. Check for dedicated test database environment variable
    const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_TEST_URL;
    if (testDbUrl) {
      const testDbName = parseDatabaseName(testDbUrl);
      if (isSharedDevelopmentDatabase(testDbName)) {
        return {
          connectionString: testDbUrl,
          databaseName: testDbName,
          isTestEnvironment: true,
          isBlocked: true,
          blockReason: `Safety guard violation: TEST_DATABASE_URL points to the shared development database '${SHARED_DEV_DB_NAME}'. Automated tests must never write to or access the development database. Please specify a dedicated test database (e.g. '${DEFAULT_TEST_DB_NAME}').`,
        };
      }
      return {
        connectionString: testDbUrl,
        databaseName: testDbName,
        isTestEnvironment: true,
        isBlocked: false,
      };
    }

    // 2. If TEST_DATABASE_URL is not set, check fallback DATABASE_URL
    const fallbackUrl = process.env.DATABASE_URL;
    const fallbackDbName = parseDatabaseName(fallbackUrl);

    // If pointing to shared development database 'oneclick_crm' (or not configured), FAIL SAFELY!
    if (!fallbackUrl || !fallbackDbName || isSharedDevelopmentDatabase(fallbackDbName)) {
      return {
        connectionString: fallbackUrl || '',
        databaseName: fallbackDbName || SHARED_DEV_DB_NAME,
        isTestEnvironment: true,
        isBlocked: true,
        blockReason: `Safety guard violation: Automated tests are configured to use shared development database '${SHARED_DEV_DB_NAME}'. Tests must never write to the shared development database. Please configure a dedicated test database via TEST_DATABASE_URL (e.g. '${DEFAULT_TEST_DB_NAME}').`,
      };
    }

    // If fallbackUrl points to an explicit test database (e.g. oneclick_crm_test)
    if (isDedicatedTestDatabase(fallbackDbName)) {
      return {
        connectionString: fallbackUrl,
        databaseName: fallbackDbName,
        isTestEnvironment: true,
        isBlocked: false,
      };
    }

    // Any other database in test mode that is not explicitly named with a test prefix/suffix is blocked safely
    return {
      connectionString: fallbackUrl,
      databaseName: fallbackDbName,
      isTestEnvironment: true,
      isBlocked: true,
      blockReason: `Safety guard violation: Target database '${fallbackDbName}' is not recognized as a dedicated test database (expected name ending with '_test'). Automated tests must use a dedicated test database.`,
    };
  }

  // Development or Production runtime. Never silently fall back to a local/demo
  // database: on serverless hosts that can make the app appear to work while data
  // disappears between invocations.
  const connStr = (process.env.DATABASE_URL || '').trim();
  if (!connStr) {
    return {
      connectionString: '',
      databaseName: '',
      isTestEnvironment: false,
      isBlocked: true,
      blockReason: 'DATABASE_URL is not configured. Persistent database access is disabled until a real PostgreSQL connection is configured.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(connStr);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
  } catch {
    return {
      connectionString: connStr,
      databaseName: parseDatabaseName(connStr),
      isTestEnvironment: false,
      isBlocked: true,
      blockReason: 'DATABASE_URL is invalid. Provide a valid PostgreSQL connection URL.',
    };
  }

  const dbName = parseDatabaseName(connStr);
  const placeholder = /^(?:user|username|password|postgres_password|replace_me|changeme|example)$/i;
  const hasPlaceholderCredentials = placeholder.test(decodeURIComponent(parsed.username || '')) ||
    placeholder.test(decodeURIComponent(parsed.password || ''));
  const host = parsed.hostname.toLowerCase();
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (process.env.NODE_ENV === 'production' && (hasPlaceholderCredentials || localHost || !dbName)) {
    return {
      connectionString: connStr,
      databaseName: dbName,
      isTestEnvironment: false,
      isBlocked: true,
      blockReason: 'Production database configuration is unsafe: use a non-placeholder PostgreSQL URL pointing to the intended persistent database.',
    };
  }

  return {
    connectionString: connStr,
    databaseName: dbName,
    isTestEnvironment: false,
    isBlocked: false,
  };
}
